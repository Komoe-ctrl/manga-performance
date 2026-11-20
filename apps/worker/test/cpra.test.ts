import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTemplateWorkbook, getTemplate } from "@manga/core/collection";
import { computeCpraForPeriod, cpraTemplateOptions } from "@manga/db/cpra";
import { handleHotelCompute } from "../src/jobs/hotel-compute";
import { handleParseSubmission, type ObjectReader } from "../src/jobs/parse-submission";
import { db, makeDeps, resetDatabase, shutdown } from "./helpers";

const SECRET = "t".repeat(40);
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const TEMPLATE = "hotel_consommables_cpro";

class MemoryReader implements ObjectReader {
  objects = new Map<string, Uint8Array>();
  async read(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error("NoSuchKey");
    return object;
  }
}

/** A fictitious client with its catalogue: PH (conversion missing for « Paquet »), Javel, Gel. */
async function seed() {
  const prospect = await db().prospect.create({ data: { companyName: "Groupe Fictif", companyNameNorm: "groupe fictif", sector: "Hôtellerie", source: "MANUEL", status: "CLIENT" } });
  const client = await db().client.create({ data: { prospectId: prospect.id, legalName: "Groupe Fictif" } });
  const hotel = await db().entity.create({ data: { clientId: client.id, name: "Hôtel Test", sector: "HOTELLERIE" } });
  const plan = await db().collectionPlan.create({ data: { entityId: hotel.id, templateId: TEMPLATE, startsOn: day(2026, 1, 1) } });

  const make = (code: string, label: string, referenceUnit: string) => db().clientProduct.create({ data: { clientId: client.id, code, label, referenceUnit } });
  const ph = await make("PH", "PH (Papier hygiénique)", "unite");
  const javel = await make("JAVEL", "Javel", "ml");
  const gel = await make("GEL", "Gel douche", "ml");
  await db().productConversion.createMany({
    data: [
      { productId: ph.id, deliveryUnit: "Rouleau", factor: 1 },
      { productId: ph.id, deliveryUnit: "Paquet", factor: null },
      { productId: javel.id, deliveryUnit: "Bidon 4 L", factor: 4000 },
      { productId: gel.id, deliveryUnit: "Flacon 500 ml", factor: 500 },
    ],
  });
  await db().cpraNorm.createMany({
    data: [
      { productId: ph.id, validFrom: day(2026, 1, 1), normPerClient: 1, nonUserRate: 0.15, unitCostFcfa: 76.5 },
      { productId: javel.id, validFrom: day(2026, 1, 1), normPerClient: 9.55, nonUserRate: 0, unitCostFcfa: 0.6667 },
      { productId: gel.id, validFrom: day(2026, 1, 1), normPerClient: 25, nonUserRate: 0, unitCostFcfa: 2 },
    ],
  });
  await db().entityCpraSetting.create({ data: { entityId: hotel.id, validFrom: day(2026, 1, 1), longStayFactor: 1.1 } });
  return { client, hotel, plan, ph, javel, gel };
}

async function period(planId: string, month = 10) {
  return db().collectionPeriod.create({ data: { planId, periodStart: day(2026, month, 1), periodEnd: day(2026, month + 1, 0), dueAt: day(2026, month + 1, 3), status: "EN_CONTROLE" } });
}

type Delivery = [produit: string, unite: string, quantite: number];

async function workbook(hotelId: string, p: { id: string; periodStart: Date; periodEnd: Date; dueAt: Date }, clientId: string, deliveries: Delivery[], population = [1200, 1000, 200]) {
  const base = await buildTemplateWorkbook({
    template: getTemplate(TEMPLATE)!,
    entity: { id: hotelId, name: "Hôtel Test" },
    period: { id: p.id, start: p.periodStart, end: p.periodEnd, dueAt: p.dueAt },
    secret: SECRET,
    options: await cpraTemplateOptions(db(), clientId),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(base as unknown as ArrayBuffer);
  const cpro = wb.getWorksheet("Saisie_CPRO")!;
  deliveries.forEach(([produit, unite, quantite], i) => {
    const row = i + 2;
    cpro.getCell(row, 1).value = produit;
    cpro.getCell(row, 2).value = unite;
    cpro.getCell(row, 3).value = quantite;
    cpro.getCell(row, 4).value = day(2026, 10, 5 + i);
    cpro.getCell(row, 5).value = `BL-${i + 1}`;
  });
  population.forEach((v, i) => (wb.getWorksheet("Population")!.getCell(2, i + 1).value = v));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

let sequence = 0;
/** Plays the whole chain: deposit, check by the worker, then the computation job it queued. */
async function deposit(s: Awaited<ReturnType<typeof seed>>, periodId: string, deliveries: Delivery[], version = 1) {
  const p = await db().collectionPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const reader = new MemoryReader();
  sequence += 1;
  const bytes = await workbook(s.hotel.id, p, s.client.id, deliveries);
  reader.objects.set(`k/${sequence}`, bytes);
  const submission = await db().submission.create({
    data: { periodId, version, templateId: TEMPLATE, templateVersion: 1, storageKey: `k/${sequence}`, originalName: "d.xlsx", sizeBytes: bytes.length, checksum: "x", uploadedBy: "u1", status: "EN_CONTROLE" },
  });
  const { deps, queue } = makeDeps();
  await handleParseSubmission({ submissionId: submission.id }, { ...deps, storage: reader });
  return { submission, queue, deps };
}

const results = (periodId: string, version?: number) => db().cpraResult.findMany({ where: { periodId, ...(version ? { version } : {}) }, include: { product: true }, orderBy: { product: { code: "asc" } } });
const by = (list: Awaited<ReturnType<typeof results>>, code: string) => list.find((r) => r.product.code === code)!;

beforeEach(resetDatabase);
afterAll(shutdown);

describe("catalogue options for the deposit template", () => {
  it("lists the products and their declared units, including a unit whose factor is still missing", async () => {
    const s = await seed();
    const options = await cpraTemplateOptions(db(), s.client.id);
    expect(options.produits).toEqual(["Gel douche", "Javel", "PH (Papier hygiénique)"]); // catalogue order: by code
    expect(options.unites["PH (Papier hygiénique)"]).toEqual(["Paquet", "Rouleau"]);
  });

  it("a deposit with a catalogue product and unit passes the check, even when the conversion is missing", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    const { submission } = await deposit(s, p.id, [["PH (Papier hygiénique)", "Paquet", 50], ["Javel", "Bidon 4 L", 3], ["Gel douche", "Flacon 500 ml", 100]]);
    const after = await db().submission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(after.status).toBe("VALIDE");
  });

  it("rejects a product that is not in the client's catalogue", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    const { submission, queue } = await deposit(s, p.id, [["Parfum d'ambiance", "Rouleau", 5]]);
    expect((await db().submission.findUniqueOrThrow({ where: { id: submission.id } })).status).toBe("REJETE");
    expect(queue.computes).toEqual([]);
  });
});

describe("hotel.compute", () => {
  it("is queued when a deposit is validated, then computes the gaps from the deposit and the parameters", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    // PH 1037 expected (1 x 0.85 x (1000 + 200 x 1.1)): 1100 rolls. Javel 11651 ml: 3 bidons = 12000 ml. Gel 30500 ml: none delivered.
    const { submission, queue, deps } = await deposit(s, p.id, [["PH (Papier hygiénique)", "Rouleau", 1100], ["Javel", "Bidon 4 L", 3]]);
    expect(queue.computes).toEqual([{ periodId: p.id, dedupeKey: submission.id }]);

    await handleHotelCompute({ periodId: p.id }, deps);
    const list = await results(p.id);
    expect(list).toHaveLength(3);

    const ph = by(list, "PH");
    expect(Number(ph.cpra)).toBeCloseTo(1037, 4);
    expect(Number(ph.cproRef)).toBe(1100);
    expect(Number(ph.ecartVolume)).toBeCloseTo(63, 4);
    expect(ph.ecartValorise).toBe(4820);
    expect(ph.status).toBe("SUR");
    expect(ph.version).toBe(1);
    expect(ph.submissionId).toBe(submission.id);
    expect(ph.paramsSnapshot).toMatchObject({ longStayFactor: 1.1, population: { pass: 1000, longSejour: 200 }, norm: { scope: "CLIENT", nonUserRate: 0.15, unitCost: 76.5 } });

    expect(by(list, "JAVEL")).toMatchObject({ status: "CONFORME", ecartValorise: 233 });
    expect(by(list, "GEL")).toMatchObject({ status: "CPRO_MANQUANT", cproRef: null, ecartValorise: null });
  });

  it("flags a missing conversion factor without computing a gap", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    const { deps } = await deposit(s, p.id, [["PH (Papier hygiénique)", "Paquet", 50]]);
    await handleHotelCompute({ periodId: p.id }, deps);
    expect(by(await results(p.id), "PH")).toMatchObject({ status: "CONVERSION_MANQUANTE", cproRef: null, ecartVolume: null, ecartValorise: null });
  });

  it("is idempotent: running the job twice does not create a second version", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    const { deps } = await deposit(s, p.id, [["Javel", "Bidon 4 L", 3]]);
    await handleHotelCompute({ periodId: p.id }, deps);
    await handleHotelCompute({ periodId: p.id }, deps);
    expect(await db().cpraResult.count({ where: { periodId: p.id } })).toBe(3);
    expect(await db().auditLog.count({ where: { action: "CPRA_COMPUTED" } })).toBe(1);
  });

  it("does not compute without an accepted deposit, nor for another kind of plan", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    expect(await computeCpraForPeriod(db(), { periodId: p.id, actorId: null, force: false })).toEqual({ computed: false, reason: "NO_ACCEPTED_SUBMISSION" });
    expect(await computeCpraForPeriod(db(), { periodId: "inconnue", actorId: null, force: false })).toEqual({ computed: false, reason: "NOT_FOUND" });
    const other = await db().entity.create({ data: { clientId: s.client.id, name: "Resto", sector: "RESTAURATION" } });
    const plan = await db().collectionPlan.create({ data: { entityId: other.id, templateId: "resto_mensuel", startsOn: day(2026, 1, 1) } });
    const op = await period(plan.id);
    expect(await computeCpraForPeriod(db(), { periodId: op.id, actorId: null, force: true })).toEqual({ computed: false, reason: "NOT_CPRA_PLAN" });
  });

  it("uses the deposit accepted with reserve, and the latest accepted version", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    const first = await deposit(s, p.id, [["Javel", "Bidon 4 L", 1]]);
    await db().submission.update({ where: { id: first.submission.id }, data: { status: "REJETE" } });
    const second = await deposit(s, p.id, [["Javel", "Bidon 4 L", 3]], 2);
    await db().submission.update({ where: { id: second.submission.id }, data: { status: "ACCEPTE_AVEC_RESERVE" } });
    await handleHotelCompute({ periodId: p.id }, second.deps);
    const javel = by(await results(p.id), "JAVEL");
    expect(javel.submissionId).toBe(second.submission.id);
    expect(Number(javel.cproRef)).toBe(12000);
  });
});

describe("recalculation", () => {
  it("creates a new version when a norm changes, keeps the old one untouched, and records who and why", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    const { deps } = await deposit(s, p.id, [["Javel", "Bidon 4 L", 3]]);
    await handleHotelCompute({ periodId: p.id }, deps);
    const before = by(await results(p.id, 1), "JAVEL");

    // A new norm from November: editing parameters alone never moves the history.
    await db().cpraNorm.create({ data: { productId: s.javel.id, validFrom: day(2026, 9, 1), normPerClient: 12, nonUserRate: 0, unitCostFcfa: 1 } });
    expect(by(await results(p.id), "JAVEL").id).toBe(before.id);

    const admin = await db().user.create({ data: { email: "a@example.com", name: "Consultant", role: "ADMIN" } });
    const out = await computeCpraForPeriod(db(), { periodId: p.id, actorId: admin.id, note: "Nouvelle norme javel", force: true });
    expect(out).toMatchObject({ computed: true, version: 2 });

    const v1 = by(await results(p.id, 1), "JAVEL");
    const v2 = by(await results(p.id, 2), "JAVEL");
    expect(Number(v1.cpra)).toBeCloseTo(11651, 3);
    expect(v1.id).toBe(before.id);
    expect(Number(v2.cpra)).toBeCloseTo(14640, 3); // 12 x 1220
    expect(v2).toMatchObject({ note: "Nouvelle norme javel", computedBy: admin.id });
    expect(v2.paramsSnapshot).toMatchObject({ norm: { normPerClient: 12, unitCost: 1 } });
  });

  it("applies the hotel's own norm over the client's, and skips a product with no norm yet", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    await db().cpraNorm.create({ data: { productId: s.gel.id, entityId: s.hotel.id, validFrom: day(2026, 6, 1), normPerClient: 30, nonUserRate: 0, unitCostFcfa: 2 } });
    await db().cpraNorm.deleteMany({ where: { productId: s.ph.id } });
    const { deps } = await deposit(s, p.id, [["Gel douche", "Flacon 500 ml", 100]]);
    await handleHotelCompute({ periodId: p.id }, deps);
    const list = await results(p.id);
    expect(list.map((r) => r.product.code)).toEqual(["GEL", "JAVEL"]);
    expect(Number(by(list, "GEL").cpra)).toBeCloseTo(36600, 3); // 30 x 1220
    expect(by(list, "GEL").paramsSnapshot).toMatchObject({ norm: { scope: "ENTITY" } });
    const audit = await db().auditLog.findFirstOrThrow({ where: { action: "CPRA_COMPUTED" } });
    expect(audit.diff).toMatchObject({ skipped: ["PH"] });
  });

  it("uses the client's coverage bounds when they are configured", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    await db().setting.create({ data: { key: `cpra.bounds.${s.client.id}`, value: { strongUnder: 50, under: 90, overFrom: 130, strongOver: 200 } } });
    const { deps } = await deposit(s, p.id, [["PH (Papier hygiénique)", "Rouleau", 1100]]);
    await handleHotelCompute({ periodId: p.id }, deps);
    expect(by(await results(p.id), "PH").status).toBe("CONFORME"); // 106 %
  });

  it("falls back to the default bounds when the setting is incoherent", async () => {
    const s = await seed();
    const p = await period(s.plan.id);
    await db().setting.create({ data: { key: `cpra.bounds.${s.client.id}`, value: { strongUnder: 90, under: 80, overFrom: 130, strongOver: 200 } } });
    const { deps } = await deposit(s, p.id, [["PH (Papier hygiénique)", "Rouleau", 1100]]);
    await handleHotelCompute({ periodId: p.id }, deps);
    expect(by(await results(p.id), "PH").status).toBe("SUR");
  });
});
