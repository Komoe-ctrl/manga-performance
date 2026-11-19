import { beforeEach, describe, expect, it } from "vitest";
import { PILOT_MONTHS, VALIDATED_UNTIL, initialParams, normFor, pilotHotels } from "@/lib/mock/pilot";
import { getClientPilotResults, getPilotParams, getPilotResults, getPilotVersions, recomputePilot, resetPilot, savePilotParams } from "@/lib/services/pilot";

beforeEach(resetPilot);

const find = async (hotelId: string, month: string) => (await getPilotResults()).results.find((r) => r.hotelId === hotelId && r.monthKey === month)!;
const ecart = async (hotelId: string, month: string, code: string) => (await find(hotelId, month)).ecarts.find((e) => e.productCode === code)!;

describe("pilot demo data", () => {
  it("has three fictitious hotels and six months of results for each", async () => {
    const data = await getPilotResults();
    expect(pilotHotels).toHaveLength(3);
    expect(data.months).toHaveLength(6);
    expect(data.results).toHaveLength(18);
    expect(data.results.every((r) => r.ecarts.length === 4)).toBe(true);
  });

  it("shows every status the avenant defines, computed rather than written down", async () => {
    const statuses = new Set((await getPilotResults()).results.flatMap((r) => r.ecarts.map((e) => e.status)));
    for (const status of ["CONFORME", "SOUS", "SOUS_FORTE", "SUR", "SUR_FORTE", "CPRO_MANQUANT", "CONVERSION_MANQUANTE"]) expect(statuses.has(status as never)).toBe(true);
  });

  it("builds the designed cases", async () => {
    expect((await ecart("ce-1", "2026-06", "GEL")).status).toBe("SUR_FORTE");
    expect((await ecart("ce-1", "2026-08", "PH")).status).toBe("SOUS_FORTE");
    expect((await ecart("ce-2", "2026-05", "JAVEL")).status).toBe("SUR");
    expect((await ecart("ce-2", "2026-08", "SHAMP")).status).toBe("SOUS");
    const noDelivery = await ecart("ce-3", "2026-06", "SHAMP");
    expect(noDelivery).toMatchObject({ status: "CPRO_MANQUANT", cpro: null, ecartValorise: null });
    const packet = await ecart("ce-2", "2026-07", "PH");
    expect(packet).toMatchObject({ status: "CONVERSION_MANQUANTE", cpro: null, ecartValorise: null, missingConversion: "Paquet" });
  });

  it("values the gap in whole FCFA and totals it per hotel", async () => {
    const row = await find("ce-1", "2026-06");
    for (const e of row.ecarts) if (e.ecartValorise !== null) expect(Number.isInteger(e.ecartValorise)).toBe(true);
    expect(row.totalEcartValorise).toBe(row.ecarts.reduce((s, e) => s + (e.ecartValorise ?? 0), 0));
    // Over-consumption of gel in June: a positive valued gap.
    expect((await ecart("ce-1", "2026-06", "GEL")).ecartValorise).toBeGreaterThan(0);
  });

  it("derives hotel KPIs and the avenant's alerts from the same pure functions", async () => {
    const august = await find("ce-2", "2026-08");
    expect(august.kpis.gopMarginPct).toBeLessThan(30);
    expect(august.alerts.map((a) => a.code)).toContain("GOP_MARGIN_LOW");
    expect(august.kpis.gop).toBe(august.structure.gop);
    const healthy = await find("ce-1", "2026-05");
    expect(healthy.kpis.gopMarginPct).toBeGreaterThan(30);
    expect(healthy.kpis.revpar).not.toBeNull();
  });

  it("is deterministic: the demo is identical on every load", async () => {
    expect(JSON.stringify(await getPilotResults())).toBe(JSON.stringify(await getPilotResults()));
  });
});

describe("norms with an effective date", () => {
  it("applies the last norm whose date is on or before the month, the hotel's before the client's", () => {
    const params = initialParams();
    expect(normFor(params, "GEL", "ce-1", "2026-09")).toBe(25);
    expect(normFor(params, "GEL", "ce-3", "2026-06")).toBe(25);
    expect(normFor(params, "GEL", "ce-3", "2026-07")).toBe(30);
    expect(normFor(params, "GEL", "ce-3", "2026-09")).toBe(30);
    expect(normFor(params, "INCONNU", "ce-1", "2026-09")).toBeNull();
    expect(normFor(params, "GEL", "ce-1", "2025-12")).toBeNull();
  });
});

describe("recalculation and versions", () => {
  it("keeps results unchanged when settings are edited, flags them stale, and only a recalculation applies them", async () => {
    const before = await find("ce-1", "2026-09");
    const params = await getPilotParams();
    params.products.find((p) => p.code === "GEL")!.unitCost = 1.2;
    await savePilotParams(params);

    const stale = await getPilotResults();
    expect(stale.stale).toBe(true);
    expect(stale.version).toBe(1);
    expect(stale.results.find((r) => r.hotelId === "ce-1" && r.monthKey === "2026-09")).toEqual(before);

    const version = await recomputePilot("Nouveau coût du gel douche");
    expect(version).toBe(2);
    const after = await getPilotResults();
    expect(after.version).toBe(2);
    expect(after.stale).toBe(false);
    const gelBefore = before.ecarts.find((e) => e.productCode === "GEL")!;
    const gelAfter = after.results.find((r) => r.hotelId === "ce-1" && r.monthKey === "2026-09")!.ecarts.find((e) => e.productCode === "GEL")!;
    expect(gelAfter.cpra).toBe(gelBefore.cpra);
    expect(Math.abs(gelAfter.ecartValorise ?? 0)).toBeGreaterThan(Math.abs(gelBefore.ecartValorise ?? 0));
  });

  it("keeps the previous version readable, with its own results", async () => {
    const params = await getPilotParams();
    params.longStayFactor["ce-1"] = 1.5;
    await savePilotParams(params);
    await recomputePilot("Facteur long séjour");
    const v1 = await getPilotResults(1);
    const v2 = await getPilotResults(2);
    const cpra = (r: typeof v1) => r.results.find((x) => x.hotelId === "ce-1" && x.monthKey === "2026-06")!.ecarts.find((e) => e.productCode === "JAVEL")!.cpra;
    expect(cpra(v2)).toBeGreaterThan(cpra(v1));
    const versions = await getPilotVersions();
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ by: "Consultant (démo)", note: "Facteur long séjour" });
    await expect((async () => getPilotResults(99))()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses a default note and refuses invalid settings", async () => {
    await recomputePilot("   ");
    expect((await getPilotVersions())[0]!.note).toBe("Recalcul manuel");
    const bad = async (edit: (p: Awaited<ReturnType<typeof getPilotParams>>) => void) => {
      const p = await getPilotParams();
      edit(p);
      return savePilotParams(p);
    };
    await expect((async () => bad((p) => (p.products[0]!.unitCost = -1)))()).rejects.toMatchObject({ code: "VALIDATION" });
    await expect((async () => bad((p) => (p.products[0]!.nonUserRate = 1.5)))()).rejects.toMatchObject({ code: "VALIDATION" });
    await expect((async () => bad((p) => (p.conversions[0]!.factor = 0)))()).rejects.toMatchObject({ code: "VALIDATION" });
    await expect((async () => bad((p) => (p.norms[0]!.normPerClient = -3)))()).rejects.toMatchObject({ code: "VALIDATION" });
    await expect((async () => bad((p) => (p.longStayFactor["ce-1"] = 0.5)))()).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await getPilotResults()).stale).toBe(false); // nothing was saved
  });

  it("flags the missing conversion until a factor is given, then computes it", async () => {
    const before = await ecart("ce-2", "2026-07", "PH");
    expect(before.status).toBe("CONVERSION_MANQUANTE");
    const params = await getPilotParams();
    params.conversions.find((c) => c.deliveryUnit === "Paquet")!.factor = 12;
    await savePilotParams(params);
    await recomputePilot("Facteur du paquet de PH");
    const after = (await getPilotResults()).results.find((r) => r.hotelId === "ce-2" && r.monthKey === "2026-07")!.ecarts.find((e) => e.productCode === "PH")!;
    expect(after.cpro).not.toBeNull();
    expect(after.status).not.toBe("CONVERSION_MANQUANTE");
  });
});

describe("what the client sees", () => {
  it("only shows months validated by the consultant, from the latest version", async () => {
    const client = await getClientPilotResults();
    expect(client.months.map((m) => m.key)).toEqual(PILOT_MONTHS.filter((m) => m.key <= VALIDATED_UNTIL).map((m) => m.key));
    expect(client.results.every((r) => r.monthKey <= VALIDATED_UNTIL)).toBe(true);
    expect(client.results).toHaveLength(15);
    expect(client.stale).toBe(false);
  });

  it("follows the latest version, but never exposes a month waiting for validation", async () => {
    const params = await getPilotParams();
    params.longStayFactor["ce-1"] = 1.4;
    await savePilotParams(params);
    await recomputePilot("x");
    const client = await getClientPilotResults();
    expect(client.version).toBe(2);
    expect(client.results.some((r) => r.monthKey === "2026-09")).toBe(false);
  });
});
