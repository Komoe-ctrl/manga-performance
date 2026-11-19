import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkWorkbook, getTemplate, type PeriodContext } from "@manga/core/collection";
import { createTemplateService } from "@/server/collection/template-service";
import { createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";

const SECRET = "test-secret-test-secret-test-secret-1234";
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const PERIOD = { id: "period-oct", start: day(2026, 10, 1), end: day(2026, 10, 31), dueAt: day(2026, 11, 3) };
const CTX: PeriodContext = { periodStart: PERIOD.start, periodEnd: PERIOD.end };

async function fill(buffer: Buffer, edit: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  edit(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const HOTEL_ROW = { A: 40, B: 900, C: 45_000_000, D: 60_000_000, E: 25_000_000, F: 12_000_000 };
const fillHotel = (wb: ExcelJS.Workbook) => {
  const ws = wb.getWorksheet("Saisie_Mensuelle")!;
  Object.entries(HOTEL_ROW).forEach(([col, v]) => (ws.getCell(`${col}2`).value = v));
};


describe("template route service", () => {
  beforeEach(resetDatabase);
  afterAll(shutdown);

  async function seed() {
    const clientA = await createClientCompany("Groupe A");
    const clientB = await createClientCompany("Groupe B");
    const a1 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A1", sector: "HOTELLERIE" } });
    const a2 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A2", sector: "HOTELLERIE" } });
    const b1 = await db().entity.create({ data: { clientId: clientB.id, name: "Hôtel B1", sector: "HOTELLERIE" } });
    const period = async (entityId: string, templateId = "hotel_mensuel") => {
      const plan = await db().collectionPlan.create({ data: { entityId, templateId, startsOn: day(2026, 1, 1) } });
      return db().collectionPeriod.create({ data: { planId: plan.id, periodStart: PERIOD.start, periodEnd: PERIOD.end, dueAt: PERIOD.dueAt } });
    };
    return {
      p1: await period(a1.id),
      p2: await period(a2.id),
      pb: await period(b1.id),
      pUnknownTemplate: await period(a1.id, "inconnu"),
      admin: await createUser({ role: "ADMIN" }),
      direction: await createUser({ role: "CLIENT_DIRECTION", clientId: clientA.id }),
      analyst: await createUser({ role: "CLIENT_ANALYSTE", clientId: clientA.id }),
      contributor: await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: clientA.id }),
      a1,
    };
  }
  const service = () => createTemplateService({ prisma: db(), secret: SECRET });
  const actor = (u: { id: string; role: "ADMIN" | "CLIENT_DIRECTION" | "CLIENT_CONTRIBUTEUR" | "CLIENT_ANALYSTE"; clientId: string | null }) => ({ userId: u.id, role: u.role, clientId: u.clientId });

  it("builds a signed file bound to the entity and the period, named after both", async () => {
    const s = await seed();
    const { buffer, filename } = await service().buildForPeriod(actor(s.direction), s.p1.id);
    expect(filename).toBe("hotel_mensuel_Hotel-A1_2026-10.xlsx");
    const filled = await fill(buffer, (wb) => fillHotel(wb));
    const ok = await checkWorkbook({ buffer: filled, template: getTemplate("hotel_mensuel")!, expected: { entityId: s.a1.id, periodId: s.p1.id }, ctx: CTX, secret: SECRET });
    expect(ok.errors).toEqual([]);
    const wrong = await checkWorkbook({ buffer: filled, template: getTemplate("hotel_mensuel")!, expected: { entityId: s.a1.id, periodId: s.p2.id }, ctx: CTX, secret: SECRET });
    expect(wrong.errors.map((e) => e.code)).toEqual(["META_WRONG_PERIOD"]);
  });

  it("lets an assigned contributor download theirs and answers 404 for another entity of the same client", async () => {
    const s = await seed();
    await db().entityAssignment.create({ data: { userId: s.contributor.id, entityId: s.a1.id } });
    await expect(service().buildForPeriod(actor(s.contributor), s.p1.id)).resolves.toBeTruthy();
    await expect(service().buildForPeriod(actor(s.contributor), s.p2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers the same for another client's period and for one that does not exist", async () => {
    const s = await seed();
    for (const id of [s.pb.id, "does-not-exist"]) {
      await expect(service().buildForPeriod(actor(s.direction), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("refuses the read-only analyst, and lets the admin build any file", async () => {
    const s = await seed();
    await expect(service().buildForPeriod(actor(s.analyst), s.p1.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service().buildForPeriod(actor(s.admin), s.pb.id)).resolves.toBeTruthy();
  });

  it("refuses a period whose template is unknown", async () => {
    const s = await seed();
    await expect(service().buildForPeriod(actor(s.admin), s.pUnknownTemplate.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
