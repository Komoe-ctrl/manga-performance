import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCpraService } from "@/server/collection/cpra-service";
import { createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const service = () => createCpraService({ prisma: db() });

async function seed() {
  const admin = await createUser({ role: "ADMIN" });
  const client = await createClientCompany("Groupe Fictif");
  const other = await createClientCompany("Autre Groupe");
  const hotel = await db().entity.create({ data: { clientId: client.id, name: "Hôtel Test", sector: "HOTELLERIE" } });
  const foreign = await db().entity.create({ data: { clientId: other.id, name: "Hôtel Autre", sector: "HOTELLERIE" } });
  const shop = await db().entity.create({ data: { clientId: client.id, name: "Boutique", sector: "COMMERCE" } });
  return { admin, client, other, hotel, foreign, shop };
}

beforeEach(resetDatabase);
afterAll(shutdown);

describe("catalogue and conversions", () => {
  it("creates then updates a product by code, normalising the code, and audits", async () => {
    const s = await seed();
    const a = await service().saveProduct({ clientId: s.client.id, code: " ph ", label: "PH", referenceUnit: "unite" }, s.admin.id);
    const b = await service().saveProduct({ clientId: s.client.id, code: "PH", label: "PH (Papier hygiénique)", referenceUnit: "unite", active: false }, s.admin.id);
    expect(b.id).toBe(a.id);
    expect(await db().clientProduct.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ code: "PH", label: "PH (Papier hygiénique)", active: false });
    expect(await db().auditLog.count({ where: { action: "cpra.product" } })).toBe(2);
  });

  it("refuses invalid or duplicate products", async () => {
    const s = await seed();
    await service().saveProduct({ clientId: s.client.id, code: "PH", label: "Papier", referenceUnit: "unite" }, s.admin.id);
    const bad = (over: Partial<Parameters<ReturnType<typeof service>["saveProduct"]>[0]>) => service().saveProduct({ clientId: s.client.id, code: "X", label: "Xx", referenceUnit: "ml", ...over }, s.admin.id);
    await expect(bad({ code: "a b" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(bad({ label: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(bad({ referenceUnit: "kg" as never })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(bad({ code: "PH2", label: "Papier" })).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(bad({ clientId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("declares a unit without factor, then gives its factor", async () => {
    const s = await seed();
    const p = await service().saveProduct({ clientId: s.client.id, code: "PH", label: "PH", referenceUnit: "unite" }, s.admin.id);
    await service().setConversion({ productId: p.id, deliveryUnit: " Paquet ", factor: null }, s.admin.id);
    let params = await service().getParams(s.client.id);
    expect(params.products[0]!.conversions).toEqual([{ deliveryUnit: "Paquet", factor: null }]);
    await service().setConversion({ productId: p.id, deliveryUnit: "Paquet", factor: 12 }, s.admin.id);
    params = await service().getParams(s.client.id);
    expect(params.products[0]!.conversions).toEqual([{ deliveryUnit: "Paquet", factor: 12 }]);
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(service().setConversion({ productId: p.id, deliveryUnit: "Paquet", factor }, s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(service().setConversion({ productId: "nope", deliveryUnit: "Paquet", factor: 1 }, s.admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("dated norms, long-stay factor and bounds", () => {
  async function product(s: Awaited<ReturnType<typeof seed>>) {
    return service().saveProduct({ clientId: s.client.id, code: "JAVEL", label: "Javel", referenceUnit: "ml" }, s.admin.id);
  }
  const norm = { validFrom: "2026-01-01", normPerClient: 9.55, nonUserRate: 0, unitCostFcfa: 0.6667 };

  it("adds norms without ever editing history, and keeps Decimal precision", async () => {
    const s = await seed();
    const p = await product(s);
    await service().addNorm({ productId: p.id, entityId: null, ...norm }, s.admin.id);
    await service().addNorm({ productId: p.id, entityId: s.hotel.id, ...norm, validFrom: "2026-06-01", normPerClient: 12 }, s.admin.id);
    const params = await service().getParams(s.client.id);
    expect(params.products[0]!.norms).toEqual([
      { entityId: null, validFrom: "2026-01-01T00:00:00.000Z", normPerClient: 9.55, nonUserRate: 0, unitCost: 0.6667 },
      { entityId: s.hotel.id, validFrom: "2026-06-01T00:00:00.000Z", normPerClient: 12, nonUserRate: 0, unitCost: 0.6667 },
    ]);
    await expect(service().addNorm({ productId: p.id, entityId: null, ...norm }, s.admin.id)).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("validates norms, and refuses an entity of another client", async () => {
    const s = await seed();
    const p = await product(s);
    const add = (over: object) => service().addNorm({ productId: p.id, entityId: null, ...norm, ...over }, s.admin.id);
    await expect(add({ validFrom: "2026-02-30" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(add({ validFrom: "hier" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(add({ normPerClient: -1 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(add({ nonUserRate: 1.2 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(add({ unitCostFcfa: Number.NaN })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(add({ entityId: s.foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db().cpraNorm.count()).toBe(0);
  });

  it("sets the long-stay factor per hotel and date, only for hotels", async () => {
    const s = await seed();
    await service().setLongStayFactor({ entityId: s.hotel.id, validFrom: "2026-01-01", factor: 1.1 }, s.admin.id);
    await service().setLongStayFactor({ entityId: s.hotel.id, validFrom: "2026-01-01", factor: 1.133 }, s.admin.id);
    expect((await service().getParams(s.client.id)).longStay).toEqual([{ entityId: s.hotel.id, entityName: "Hôtel Test", validFrom: "2026-01-01T00:00:00.000Z", factor: 1.133 }]);
    await expect(service().setLongStayFactor({ entityId: s.hotel.id, validFrom: "2026-01-01", factor: 0.9 }, s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service().setLongStayFactor({ entityId: s.shop.id, validFrom: "2026-01-01", factor: 1.1 }, s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service().setLongStayFactor({ entityId: "nope", validFrom: "2026-01-01", factor: 1.1 }, s.admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stores coverage bounds per client and refuses incoherent ones", async () => {
    const s = await seed();
    expect((await service().getParams(s.client.id)).bounds).toEqual({ strongUnder: 80, under: 95, overFrom: 105, strongOver: 120 });
    await service().saveBounds(s.client.id, { strongUnder: 70, under: 90, overFrom: 110, strongOver: 140 }, s.admin.id);
    expect((await service().getParams(s.client.id)).bounds.strongOver).toBe(140);
    expect((await service().getParams(s.other.id)).bounds.strongOver).toBe(120);
    await expect(service().saveBounds(s.client.id, { strongUnder: 95, under: 80, overFrom: 105, strongOver: 120 }, s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service().saveBounds("nope", { strongUnder: 80, under: 95, overFrom: 105, strongOver: 120 }, s.admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("recompute and results", () => {
  async function accepted() {
    const s = await seed();
    const plan = await db().collectionPlan.create({ data: { entityId: s.hotel.id, templateId: "hotel_consommables_cpro", startsOn: day(2026, 1, 1) } });
    const period = await db().collectionPeriod.create({ data: { planId: plan.id, periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31), dueAt: day(2026, 11, 3), status: "VALIDE" } });
    const rows = { Saisie_CPRO: [{ produit: "Javel", uniteLivraison: "Bidon 4 L", quantite: 3 }], Population: [{ clientsTotal: 1200, clientsPass: 1000, clientsLongSejour: 200 }] };
    await db().submission.create({ data: { periodId: period.id, version: 1, templateId: "hotel_consommables_cpro", templateVersion: 1, storageKey: "k/1", originalName: "d.xlsx", sizeBytes: 1, checksum: "x", uploadedBy: "u", status: "VALIDE", rows } });
    const p = await service().saveProduct({ clientId: s.client.id, code: "JAVEL", label: "Javel", referenceUnit: "ml" }, s.admin.id);
    await service().setConversion({ productId: p.id, deliveryUnit: "Bidon 4 L", factor: 4000 }, s.admin.id);
    await service().addNorm({ productId: p.id, entityId: null, validFrom: "2026-01-01", normPerClient: 9.55, nonUserRate: 0, unitCostFcfa: 0.6667 }, s.admin.id);
    return { s, period };
  }

  it("computes a first version, then a second on request, listing both with their note", async () => {
    const { s, period } = await accepted();
    expect(await service().results(period.id)).toMatchObject({ version: null, results: [], versions: [] });
    expect(await service().recompute(period.id, "Premier calcul", s.admin.id)).toEqual({ version: 1, skipped: [] });
    await service().addNorm({ productId: (await db().clientProduct.findFirstOrThrow()).id, entityId: null, validFrom: "2026-09-01", normPerClient: 12, nonUserRate: 0, unitCostFcfa: 1 }, s.admin.id);
    expect((await service().recompute(period.id, "Nouvelle norme", s.admin.id)).version).toBe(2);

    const latest = await service().results(period.id);
    expect(latest.versions.map((v) => [v.version, v.note])).toEqual([[2, "Nouvelle norme"], [1, "Premier calcul"]]);
    expect(latest.version).toBe(2);
    expect(latest.results[0]).toMatchObject({ productCode: "JAVEL", status: "SOUS", referenceUnit: "ml" });
    const first = await service().results(period.id, 1);
    expect(first.results[0]).toMatchObject({ cpra: 11460, cpro: 12000, ecartVolume: 540, ecartValorise: 360, status: "CONFORME" });
    await expect(service().results(period.id, 9)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service().results("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("explains why it cannot recompute", async () => {
    const { s, period } = await accepted();
    await db().submission.updateMany({ data: { status: "REJETE" } });
    await expect(service().recompute(period.id, "", s.admin.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service().recompute("nope", "", s.admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db().submission.updateMany({ data: { status: "VALIDE", rows: { Saisie_CPRO: [] } } });
    await expect(service().recompute(period.id, "", s.admin.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const plan = await db().collectionPlan.create({ data: { entityId: s.shop.id, templateId: "commerce_mensuel", startsOn: day(2026, 1, 1) } });
    const other = await db().collectionPeriod.create({ data: { planId: plan.id, periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31), dueAt: day(2026, 11, 3), status: "VALIDE" } });
    await expect(service().recompute(other.id, "", s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await service().results(other.id)).toEqual({ versions: [], version: null, results: [] });
  });
});
