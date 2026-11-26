import type { Prisma } from "@manga/db";
import { parseHotelKpis } from "@manga/db/hotel-kpi";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleHotelCompute } from "../src/jobs/hotel-compute";
import { db, makeDeps, resetDatabase, shutdown } from "./helpers";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const TEMPLATE = "hotel_mensuel";
const SHEET = "Saisie_Mensuelle";

type Row = Record<string, string | number | boolean | null>;

async function seed(templateId = TEMPLATE) {
  const prospect = await db().prospect.create({ data: { companyName: "Groupe Fictif", companyNameNorm: "groupe fictif", sector: "Hôtellerie", source: "MANUEL", status: "CLIENT" } });
  const client = await db().client.create({ data: { prospectId: prospect.id, legalName: "Groupe Fictif" } });
  const hotel = await db().entity.create({ data: { clientId: client.id, name: "Hôtel Test", sector: "HOTELLERIE" } });
  const plan = await db().collectionPlan.create({ data: { entityId: hotel.id, templateId, startsOn: day(2026, 1, 1) } });
  return { client, hotel, plan };
}

async function month(planId: string, monthNumber: number) {
  return db().collectionPeriod.create({
    data: { planId, periodStart: day(2026, monthNumber, 1), periodEnd: day(2026, monthNumber + 1, 0), dueAt: day(2026, monthNumber + 1, 3), status: "VALIDE" },
  });
}

async function accepted(periodId: string, row: Row, version = 1) {
  return db().submission.create({
    data: {
      periodId,
      version,
      templateId: TEMPLATE,
      templateVersion: 1,
      storageKey: `hotel-kpi/${periodId}/${version}`,
      originalName: "mensuel.xlsx",
      sizeBytes: 1,
      checksum: "x",
      uploadedBy: "u1",
      status: "VALIDE",
      rows: { [SHEET]: [row] } as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Exemple anonymisé du client : RevPAR 30 000, TRevPAR 50 000, GOP 60 M, GOPPAR 20 000, marge 40 %. */
const clientExample: Row = {
  nombreChambres: 100,
  chambresVendues: 2250,
  caChambres: 90_000_000,
  revenusTotaux: 150_000_000,
  chargesDepartementales: 60_000_000,
  chargesNonReparties: 30_000_000,
  commissionsOta: 13_500_000,
};

async function run(periodId: string) {
  const { deps, queue } = makeDeps();
  await handleHotelCompute({ periodId }, deps);
  return { deps, queue };
}

const stored = async (periodId: string) => db().hotelKpiResult.findFirstOrThrow({ where: { periodId }, orderBy: { version: "desc" } });

beforeEach(resetDatabase);
afterAll(shutdown);

describe("hotel.compute — KPI mensuels", () => {
  it("computes the client's example, stores a version and notifies the consultant", async () => {
    const s = await seed();
    const p = await month(s.plan.id, 9);
    const submission = await accepted(p.id, clientExample);

    const { queue } = await run(p.id);
    const row = await stored(p.id);
    expect(row.version).toBe(1);
    expect(row.submissionId).toBe(submission.id);
    expect(parseHotelKpis(row.kpis)).toMatchObject({
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
    expect(row.alerts).toMatchObject([{ code: "ANNEXES_STRONG", level: "info" }]);
    expect(row.paramsSnapshot).toMatchObject({ input: clientExample, missing: [], period: { start: p.periodStart.toISOString() } });

    expect(queue.emails).toHaveLength(1);
    expect(queue.emails[0]!.job).toMatchObject({
      template: "hotel-kpi-alert",
      to: "admin@example.com",
      data: { entityName: "Hôtel Test", clientName: "Groupe Fictif", revpar: 30_000, goppar: 20_000 },
    });
    expect(queue.emails[0]!.dedupeKey).toBe(`hotel-kpi-alert:${p.id}:1`);
    expect(await db().auditLog.count({ where: { action: "HOTEL_KPIS_COMPUTED", entityId: p.id } })).toBe(1);
  });

  it("is idempotent: a second run creates no new version and no second email", async () => {
    const s = await seed();
    const p = await month(s.plan.id, 9);
    await accepted(p.id, clientExample);
    const first = await run(p.id);
    const second = await run(p.id);

    expect(await db().hotelKpiResult.count({ where: { periodId: p.id } })).toBe(1);
    expect(first.queue.emails).toHaveLength(1);
    expect(second.queue.emails).toEqual([]);
    expect(await db().auditLog.count({ where: { action: "HOTEL_KPIS_COMPUTED" } })).toBe(1);
  });

  it("compares with the previous month and flags costs outpacing revenue", async () => {
    const s = await seed();
    // August has 31 days: 3 100 available rooms. Previous RevPAR 29 000, previous GOPPAR 22 000.
    const previous = await month(s.plan.id, 8);
    await accepted(previous.id, {
      ...clientExample,
      caChambres: 89_900_000, // 29 000 × 3 100
      revenusTotaux: 155_000_000,
      chargesDepartementales: 56_800_000,
      // 155 M − 56.8 M − 30 M = 68.2 M, soit 22 000 par chambre disponible.
    });
    await run(previous.id);

    const current = await month(s.plan.id, 9);
    await accepted(current.id, clientExample);
    const { queue } = await run(current.id);

    const row = await stored(current.id);
    expect(row.previous).toMatchObject({ revpar: 29_000, goppar: 22_000 });
    expect(row.alerts).toMatchObject([
      { code: "COSTS_OUTPACE", level: "watch" },
      { code: "ANNEXES_STRONG", level: "info" },
    ]);
    expect(JSON.stringify(queue.emails[0]!.job)).toContain("Les coûts progressent plus vite que les revenus");
  });

  it("reports missing inputs with null ratios instead of NaN, and still alerts the consultant", async () => {
    const s = await seed();
    const p = await month(s.plan.id, 9);
    await accepted(p.id, { ...clientExample, nombreChambres: null, chambresVendues: null, caChambres: null });
    const { queue } = await run(p.id);

    const row = await stored(p.id);
    const kpis = parseHotelKpis(row.kpis)!;
    expect(kpis.revpar).toBeNull();
    expect(kpis.trevpar).toBeNull();
    expect(kpis.adr).toBeNull();
    expect(row.alerts).toMatchObject([
      { code: "INPUT_MISSING", level: "missing" },
      { code: "INPUT_MISSING", level: "missing" },
      { code: "INPUT_MISSING", level: "missing" },
    ]);
    expect(JSON.stringify(row.alerts)).toContain("Nombre de chambres");
    expect(JSON.stringify(row.alerts)).not.toMatch(/NaN|Infinity/);
    expect(queue.emails).toHaveLength(1);
  });

  it("never builds the GOP figures on a missing amount: no invented margin, no margin alert", async () => {
    const s = await seed();
    const p = await month(s.plan.id, 9);
    // Revenue present but the non-allocated costs are missing: reading them as 0 would give a 60 % margin.
    await accepted(p.id, { ...clientExample, chargesNonReparties: null });
    const { queue } = await run(p.id);

    const row = await stored(p.id);
    const kpis = parseHotelKpis(row.kpis)!;
    expect(kpis.gopMarginPct).toBeNull();
    expect(kpis.goppar).toBeNull();
    expect(kpis.revpar).toBe(30_000); // what does not depend on the missing amount stays computed
    expect(kpis.trevpar).toBe(50_000);
    expect((row.alerts as { code: string }[]).map((x) => x.code)).toEqual(["INPUT_MISSING", "ANNEXES_STRONG"]);
    expect(queue.emails).toHaveLength(1);

    // Missing revenue: TRevPAR and the margin are empty too.
    const q = await month(s.plan.id, 10);
    await accepted(q.id, { ...clientExample, revenusTotaux: null });
    await run(q.id);
    const second = parseHotelKpis((await stored(q.id)).kpis)!;
    expect(second.trevpar).toBeNull();
    expect(second.gopMarginPct).toBeNull();
    expect(second.goppar).toBeNull();
  });

  it("does not compute without an accepted deposit, nor for another template", async () => {
    const s = await seed();
    const p = await month(s.plan.id, 9);
    const { queue } = await run(p.id);
    expect(await db().hotelKpiResult.count()).toBe(0);
    expect(queue.emails).toEqual([]);

    const other = await seed("commerce_mensuel");
    const op = await month(other.plan.id, 10);
    await accepted(op.id, clientExample);
    await run(op.id);
    expect(await db().hotelKpiResult.count()).toBe(0);
  });

  it("uses the latest accepted version, including one accepted with reserve", async () => {
    const s = await seed();
    const p = await month(s.plan.id, 9);
    await accepted(p.id, { ...clientExample, chargesDepartementales: 55_000_000 });
    const second = await accepted(p.id, clientExample, 2);
    await db().submission.update({ where: { id: second.id }, data: { status: "ACCEPTE_AVEC_RESERVE" } });
    await run(p.id);
    const row = await stored(p.id);
    expect(row.submissionId).toBe(second.id);
    expect(parseHotelKpis(row.kpis)!.gop).toBe(60_000_000);
  });
});
