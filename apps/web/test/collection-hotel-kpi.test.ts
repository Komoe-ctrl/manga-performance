import type { Prisma } from "@manga/db";
import type { JobQueue } from "@manga/db/queue";
import type { EmailJob } from "@manga/emails";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHotelKpiService } from "@/server/collection/hotel-kpi-service";
import { createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

class FakeEmailQueue {
  sent: { job: EmailJob; dedupeKey?: string }[] = [];
  async enqueueEmail(job: EmailJob, options?: { dedupeKey?: string }) {
    this.sent.push({ job, dedupeKey: options?.dedupeKey });
  }
}

function service(queue: FakeEmailQueue) {
  return createHotelKpiService({
    prisma: db(),
    queue: queue as unknown as Pick<JobQueue, "enqueueEmail">,
    notification: { to: "consultant@example.com", appUrl: "https://app.example.com/" },
  });
}

async function seed(templateId = "hotel_mensuel") {
  const admin = await createUser({ role: "ADMIN" });
  const client = await createClientCompany("Groupe Fictif");
  const hotel = await db().entity.create({ data: { clientId: client.id, name: "Hôtel Test", sector: "HOTELLERIE" } });
  const plan = await db().collectionPlan.create({ data: { entityId: hotel.id, templateId, startsOn: day(2026, 1, 1) } });
  const period = await db().collectionPeriod.create({
    data: { planId: plan.id, periodStart: day(2026, 9, 1), periodEnd: day(2026, 9, 30), dueAt: day(2026, 10, 3), status: "VALIDE" },
  });
  const rows = {
    Saisie_Mensuelle: [{
      nombreChambres: 100,
      chambresVendues: 2250,
      caChambres: 90_000_000,
      revenusTotaux: 150_000_000,
      chargesDepartementales: 60_000_000,
      chargesNonReparties: 30_000_000,
      commissionsOta: 13_500_000,
    }],
  };
  await db().submission.create({
    data: {
      periodId: period.id,
      version: 1,
      templateId: "hotel_mensuel",
      templateVersion: 1,
      storageKey: `hotel-kpi/${period.id}`,
      originalName: "mensuel.xlsx",
      sizeBytes: 1,
      checksum: "x",
      uploadedBy: admin.id,
      status: "VALIDE",
      rows: rows as unknown as Prisma.InputJsonValue,
    },
  });
  return { admin, client, hotel, period };
}

beforeEach(resetDatabase);
afterAll(shutdown);

describe("KPI hôteliers — recalcul et lecture", () => {
  it("computes the client's example, returns a readable result and notifies the consultant", async () => {
    const s = await seed();
    const queue = new FakeEmailQueue();
    expect(await service(queue).results(s.period.id)).toEqual({ versions: [], version: null, result: null });

    expect(await service(queue).recompute(s.period.id, "Premier calcul", s.admin.id)).toEqual({ version: 1, alerts: 1 });
    const view = await service(queue).results(s.period.id);
    expect(view.version).toBe(1);
    expect(view.versions).toHaveLength(1);
    expect(view.result!.kpis).toMatchObject({
      chambresDisponibles: 3000,
      gop: 60_000_000,
      revpar: 30_000,
      trevpar: 50_000,
      goppar: 20_000,
      gopMarginPct: 40,
      tauxOccupationPct: 75,
      adr: 40_000,
      poidsOtaPct: 15,
    });
    expect(view.result!.alerts).toMatchObject([{ code: "ANNEXES_STRONG", level: "info" }]);
    expect(view.result!.previous).toBeNull();
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]!.job).toMatchObject({ template: "hotel-kpi-alert", to: "consultant@example.com" });
    expect(queue.sent[0]!.dedupeKey).toBe(`hotel-kpi-alert:${s.period.id}:1`);
    expect(await db().auditLog.count({ where: { action: "HOTEL_KPIS_COMPUTED" } })).toBe(1);
  });

  it("keeps previous versions on a forced recompute", async () => {
    const s = await seed();
    const queue = new FakeEmailQueue();
    await service(queue).recompute(s.period.id, "Premier calcul", s.admin.id);
    expect(await service(queue).recompute(s.period.id, "Correction", s.admin.id)).toMatchObject({ version: 2 });

    const latest = await service(queue).results(s.period.id);
    expect(latest.versions.map((v) => [v.version, v.note])).toEqual([[2, "Correction"], [1, "Premier calcul"]]);
    expect((await service(queue).results(s.period.id, 1)).result!.note).toBe("Premier calcul");
    expect(queue.sent.map((e) => e.dedupeKey)).toEqual([`hotel-kpi-alert:${s.period.id}:1`, `hotel-kpi-alert:${s.period.id}:2`]);
    await expect(service(queue).results(s.period.id, 9)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("explains why it cannot recompute", async () => {
    const s = await seed();
    const queue = new FakeEmailQueue();
    await expect(service(queue).recompute("nope", "", s.admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service(queue).results("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const otherPlan = await db().collectionPlan.create({ data: { entityId: s.hotel.id, templateId: "commerce_mensuel", startsOn: day(2026, 1, 1) } });
    const other = await db().collectionPeriod.create({ data: { planId: otherPlan.id, periodStart: day(2026, 9, 1), periodEnd: day(2026, 9, 30), dueAt: day(2026, 10, 3) } });
    await expect(service(queue).recompute(other.id, "", s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await service(queue).results(other.id)).toEqual({ versions: [], version: null, result: null });

    await db().submission.updateMany({ data: { status: "REJETE" } });
    await expect(service(queue).recompute(s.period.id, "", s.admin.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(queue.sent).toEqual([]);
  });
});
