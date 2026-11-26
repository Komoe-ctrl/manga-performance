import { CPRA_TEMPLATE_ID } from "@manga/db/cpra";
import { HOTEL_KPI_TEMPLATE_ID } from "@manga/db/hotel-kpi";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPilotResultsAction, validatePilotPeriodAction } from "@/server/actions/collection";
import { createPilotService } from "@/server/collection/pilot-service";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const service = () => createPilotService({ prisma: db() });

const KPIS = {
  chambresDisponibles: 3_000,
  gop: 60_000_000,
  revpar: 30_000,
  trevpar: 50_000,
  goppar: 20_000,
  gopMarginPct: 40,
  tauxOccupationPct: 60,
  adr: 50_000,
  poidsOtaPct: 8,
};

async function seed() {
  const admin = await createUser({ role: "ADMIN" });
  const clientA = await createClientCompany("Groupe Pilote A");
  const clientB = await createClientCompany("Groupe Pilote B");
  const direction = await createUser({ role: "CLIENT_DIRECTION", clientId: clientA.id });
  const analyst = await createUser({ role: "CLIENT_ANALYSTE", clientId: clientA.id });
  const contributor = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: clientA.id });
  const hotelA = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel Pilote A", sector: "HOTELLERIE" } });
  const hotelB = await db().entity.create({ data: { clientId: clientB.id, name: "Hôtel Pilote B", sector: "HOTELLERIE" } });
  const plan = (entityId: string, templateId: string) => db().collectionPlan.create({ data: { entityId, templateId, startsOn: day(2026, 1, 1) } });
  const period = (planId: string) =>
    db().collectionPeriod.create({
      data: { planId, periodStart: day(2026, 8, 1), periodEnd: day(2026, 8, 31), dueAt: day(2026, 9, 3), status: "VALIDE" },
    });
  const cpraPlanA = await plan(hotelA.id, CPRA_TEMPLATE_ID);
  const kpiPlanA = await plan(hotelA.id, HOTEL_KPI_TEMPLATE_ID);
  const cpraPlanB = await plan(hotelB.id, CPRA_TEMPLATE_ID);
  const cpraPeriodA = await period(cpraPlanA.id);
  const kpiPeriodA = await period(kpiPlanA.id);
  const cpraPeriodB = await period(cpraPlanB.id);

  async function submission(periodId: string, templateId: string) {
    return db().submission.create({
      data: { periodId, version: 1, templateId, templateVersion: 1, storageKey: `key-${periodId}`, originalName: "depot.xlsx", sizeBytes: 10, checksum: "x", uploadedBy: admin.id, status: "VALIDE" },
    });
  }
  const cpraSubA = await submission(cpraPeriodA.id, CPRA_TEMPLATE_ID);
  const kpiSubA = await submission(kpiPeriodA.id, HOTEL_KPI_TEMPLATE_ID);
  const cpraSubB = await submission(cpraPeriodB.id, CPRA_TEMPLATE_ID);

  async function product(clientId: string, code: string, label: string) {
    return db().clientProduct.create({ data: { clientId, code, label, referenceUnit: "unite" } });
  }
  const productA = await product(clientA.id, "PH", "Papier hygiénique");
  const productB = await product(clientB.id, "PH", "Papier hygiénique B");

  const cpraSnapshot = { lines: [{ deliveryUnit: "Rouleau", quantite: 120, factor: 1 }], population: { pass: 100, longSejour: 0 } };
  await db().cpraResult.create({
    data: {
      periodId: cpraPeriodA.id, submissionId: cpraSubA.id, productId: productA.id, version: 1,
      cproRef: 120, cpra: 100, ecartVolume: 20, couverture: 120, ecartValorise: 2000, status: "SUR", paramsSnapshot: cpraSnapshot,
    },
  });
  await db().cpraResult.create({
    data: {
      periodId: cpraPeriodB.id, submissionId: cpraSubB.id, productId: productB.id, version: 1,
      cproRef: 90, cpra: 100, ecartVolume: -10, couverture: 90, ecartValorise: -1000, status: "SOUS", paramsSnapshot: cpraSnapshot,
    },
  });
  await db().hotelKpiResult.create({
    data: {
      periodId: kpiPeriodA.id, submissionId: kpiSubA.id, version: 1, kpis: KPIS,
      alerts: [{ code: "GOP_MARGIN_LOW", level: "alert", message: "Marge basse" }],
      paramsSnapshot: { input: { nombreChambres: 100, chargesDepartementales: 60_000_000, chargesNonReparties: 30_000_000 } },
    },
  });

  return { admin, clientA, clientB, direction, analyst, contributor, hotelA, hotelB, cpraPeriodA, kpiPeriodA, cpraPeriodB };
}

beforeEach(async () => {
  await resetDatabase();
  actAs(null);
});
afterAll(shutdown);

describe("pilot results from real deposits", () => {
  it("gives the consultant every version and the client only validated ones", async () => {
    const s = await seed();
    const admin = await service().results({ clientId: null, clientOnly: false });
    expect(admin.periods).toHaveLength(3);
    expect(admin.hotels.map((h) => h.name).sort()).toEqual(["Hôtel Pilote A", "Hôtel Pilote B"]);
    const a = admin.results.find((r) => r.hotelId === s.hotelA.id)!;
    expect(a.ecarts[0]).toMatchObject({ productCode: "PH", cpra: 100, cpro: 120, ecartValorise: 2000, status: "SUR" });
    expect(a.kpis.gop).toBe(60_000_000);
    expect(a.structure.chargesDepartementales).toBe(60_000_000);
    expect(a.alerts.map((x) => x.code)).toEqual(["GOP_MARGIN_LOW"]);
    expect(admin.validatedUntil).toBe("");

    const client = await service().results({ clientId: s.clientA.id, clientOnly: true });
    expect(client.results).toEqual([]);
    expect(client.periods).toBeUndefined();
  });

  it("validates each period once, audits it, then exposes its figures without alerts", async () => {
    const s = await seed();
    const first = await service().validate(s.cpraPeriodA.id, s.admin.id);
    expect(first).toEqual({ cpra: 1, kpi: null, unchanged: false });
    expect(await service().validate(s.cpraPeriodA.id, s.admin.id)).toMatchObject({ unchanged: true });
    await service().validate(s.kpiPeriodA.id, s.admin.id);
    expect(await db().auditLog.count({ where: { action: "PILOT_RESULTS_VALIDATED" } })).toBe(2);

    const client = await service().results({ clientId: s.clientA.id, clientOnly: true });
    expect(client.hotels.map((h) => h.name)).toEqual(["Hôtel Pilote A"]);
    expect(client.months).toEqual([{ key: "2026-08", label: "Août 2026" }]);
    expect(client.validatedUntil).toBe("2026-08");
    expect(client.results).toHaveLength(1);
    expect(client.results[0]).toMatchObject({ totalEcartValorise: 2000, hasKpis: true });
    expect(client.results[0]!.alerts).toEqual([]);
    expect((await service().results({ clientId: s.clientB.id, clientOnly: true })).results).toEqual([]);
  });

  it("keeps the validated figures visible when a newer, unvalidated version is computed", async () => {
    const s = await seed();
    await service().validate(s.cpraPeriodA.id, s.admin.id);
    const submission = await db().submission.findFirstOrThrow({ where: { periodId: s.cpraPeriodA.id } });
    const product = await db().clientProduct.findFirstOrThrow({ where: { clientId: s.clientA.id } });
    await db().cpraResult.create({
      data: {
        periodId: s.cpraPeriodA.id, submissionId: submission.id, productId: product.id, version: 2,
        cproRef: 300, cpra: 100, ecartVolume: 200, couverture: 300, ecartValorise: 20_000, status: "SUR_FORTE", paramsSnapshot: {},
      },
    });
    const client = await service().results({ clientId: s.clientA.id, clientOnly: true });
    expect(client.results[0]!.ecarts[0]).toMatchObject({ ecartValorise: 2000 });
    const admin = await service().results({ clientId: null, clientOnly: false });
    expect(admin.periods!.find((p) => p.id === s.cpraPeriodA.id)!.version).toBe(2);
  });
});

describe("pilot server actions", () => {
  it("scopes direction and analyst to their client, refuses contributors, and validates as admin", async () => {
    const s = await seed();
    const { cookie } = await login(s.admin.email);
    await db().user.update({ where: { id: s.admin.id }, data: { twoFactorEnabled: true } });
    actAs(cookie);
    const admin = await getPilotResultsAction({});
    expect(admin.ok).toBe(true);
    if (admin.ok) expect(admin.data.periods).toHaveLength(3);
    expect((await validatePilotPeriodAction({ periodId: s.cpraPeriodA.id })).ok).toBe(true);

    actAs((await login(s.direction.email)).cookie);
    const direction = await getPilotResultsAction({ clientId: s.clientB.id }); // the browser cannot widen its scope
    expect(direction.ok).toBe(true);
    if (direction.ok) {
      expect(direction.data.hotels.map((h) => h.name)).toEqual(["Hôtel Pilote A"]);
      expect(direction.data.results[0]!.alerts).toEqual([]);
      expect(direction.data.periods).toBeUndefined();
    }
    expect(await validatePilotPeriodAction({ periodId: s.cpraPeriodA.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });

    actAs((await login(s.analyst.email)).cookie);
    const analyst = await getPilotResultsAction({});
    expect(analyst.ok).toBe(true);
    if (analyst.ok) {
      expect(analyst.data.hotels.map((h) => h.name)).toEqual(["Hôtel Pilote A"]);
      expect(analyst.data.results[0]!.alerts).toEqual([]);
    }

    actAs((await login(s.contributor.email)).cookie);
    expect(await getPilotResultsAction({})).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
