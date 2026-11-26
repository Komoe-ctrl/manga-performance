import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_COVERAGE_BOUNDS, basePonderee, consumableResult, cpra, cpro } from "../src/kpi/consumables";
import { hotelAlerts, hotelKpis, type HotelInput, type HotelKpis } from "../src/kpi/hotel";

const month: HotelInput = {
  nombreChambres: 40,
  chambresVendues: 900,
  caChambres: 45_000_000,
  revenusTotaux: 60_000_000,
  chargesDepartementales: 25_000_000,
  chargesNonReparties: 12_000_000,
  commissionsOta: 4_500_000,
  jours: 30,
};

describe("hotelKpis", () => {
  const k = hotelKpis(month);
  it("derives the available rooms and the GOP, which is never typed", () => {
    expect(k.chambresDisponibles).toBe(1200);
    expect(k.gop).toBe(23_000_000);
  });
  it("computes the per-available-room indicators", () => {
    expect(k.revpar).toBe(37_500);
    expect(k.trevpar).toBe(50_000);
    expect(k.goppar).toBeCloseTo(19_166.67, 2);
  });
  it("computes margin, occupancy, ADR and OTA weight", () => {
    expect(k.gopMarginPct).toBeCloseTo(38.3333, 3);
    expect(k.tauxOccupationPct).toBe(75);
    expect(k.adr).toBe(50_000);
    expect(k.poidsOtaPct).toBe(10);
  });
  it("shows « — » (null) instead of NaN or Infinity when a denominator is zero", () => {
    const empty = hotelKpis({ ...month, nombreChambres: 0, chambresVendues: 0, revenusTotaux: 0, caChambres: 0 });
    expect(empty.chambresDisponibles).toBe(0);
    expect(empty.revpar).toBeNull();
    expect(empty.trevpar).toBeNull();
    expect(empty.goppar).toBeNull();
    expect(empty.gopMarginPct).toBeNull();
    expect(empty.tauxOccupationPct).toBeNull();
    expect(empty.adr).toBeNull();
    expect(empty.poidsOtaPct).toBeNull();
  });
  it("has no OTA weight without commissions, and a zero weight with zero commissions", () => {
    expect(hotelKpis({ ...month, commissionsOta: undefined }).poidsOtaPct).toBeNull();
    expect(hotelKpis({ ...month, commissionsOta: null }).poidsOtaPct).toBeNull();
    expect(hotelKpis({ ...month, commissionsOta: 0 }).poidsOtaPct).toBe(0);
  });
  it("handles a negative GOP", () => {
    const loss = hotelKpis({ ...month, chargesDepartementales: 50_000_000 });
    expect(loss.gop).toBe(-2_000_000);
    expect(loss.gopMarginPct).toBeLessThan(0);
  });

  it("matches the anonymised client example (RevPAR 30 000, TRevPAR 50 000, GOP 60 M, GOPPAR 20 000, margin 40 %)", () => {
    const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/hotel-reference.json"), "utf8")) as {
      input: HotelInput;
      expected: Partial<HotelKpis>;
      alertCodes: string[];
    };
    const kpis = hotelKpis(fixture.input);
    expect(kpis).toMatchObject(fixture.expected);
    expect(hotelAlerts(kpis).map((a) => a.code)).toEqual(fixture.alertCodes);
  });
});

describe("hotelAlerts", () => {
  const codes = (input: Partial<HotelInput>, options?: Parameters<typeof hotelAlerts>[1]) => hotelAlerts(hotelKpis({ ...month, ...input }), options).map((a) => a.code);

  it("raises nothing on a healthy month", () => {
    expect(codes({})).toEqual([]);
  });
  it("flags a GOP margin under 30 % in red", () => {
    const alerts = hotelAlerts(hotelKpis({ ...month, chargesDepartementales: 35_000_000 }));
    expect(alerts.find((a) => a.code === "GOP_MARGIN_LOW")).toMatchObject({ level: "alert" });
  });
  it("flags a margin from 30 % to under 35 % in orange, and nothing from 35 %", () => {
    expect(codes({ chargesDepartementales: 28_000_000 })).toEqual(["GOP_MARGIN_WATCH"]); // 20/60 = 33.3 %
    expect(codes({ chargesDepartementales: 27_000_000 })).toEqual([]); // 21/60 = 35 %
  });
  it("treats exactly 30 % as orange (30 ≤ margin < 35) and just under as red", () => {
    expect(codes({ revenusTotaux: 100, caChambres: 50, chargesDepartementales: 70, chargesNonReparties: 0 })).toContain("GOP_MARGIN_WATCH");
    expect(codes({ revenusTotaux: 100, caChambres: 50, chargesDepartementales: 71, chargesNonReparties: 0 })).toContain("GOP_MARGIN_LOW");
  });
  it("flags a low profit compared with RevPAR", () => {
    // GOPPAR / RevPAR < 0.3
    expect(codes({ chargesDepartementales: 36_000_000, chargesNonReparties: 12_000_000 })).toContain("PROFIT_VS_REVPAR");
    expect(codes({})).not.toContain("PROFIT_VS_REVPAR");
  });
  it("flags costs growing faster than revenue only when RevPAR rises and GOPPAR falls", () => {
    const k = hotelKpis(month);
    expect(hotelAlerts(k, { previous: { revpar: k.revpar! - 1, goppar: k.goppar! + 1 } }).map((a) => a.code)).toContain("COSTS_OUTPACE");
    expect(hotelAlerts(k, { previous: { revpar: k.revpar! - 1, goppar: k.goppar! - 1 } }).map((a) => a.code)).not.toContain("COSTS_OUTPACE");
    expect(hotelAlerts(k, { previous: { revpar: k.revpar! + 1, goppar: k.goppar! + 1 } }).map((a) => a.code)).not.toContain("COSTS_OUTPACE");
    expect(hotelAlerts(k, { previous: { revpar: null, goppar: 1 } }).map((a) => a.code)).not.toContain("COSTS_OUTPACE");
    expect(hotelAlerts(k, { previous: null }).map((a) => a.code)).not.toContain("COSTS_OUTPACE");
  });
  it("informs about strong annexes from 1.5 × RevPAR, with a configurable factor", () => {
    expect(codes({ revenusTotaux: 67_500_000 })).toContain("ANNEXES_STRONG"); // trevpar = 1.5 × revpar exactly
    expect(codes({ revenusTotaux: 67_000_000 })).not.toContain("ANNEXES_STRONG");
    expect(codes({ revenusTotaux: 60_000_000 }, { annexesFactor: 1.2 })).toContain("ANNEXES_STRONG");
    expect(hotelAlerts(hotelKpis(month)).find((a) => a.code === "ANNEXES_STRONG")).toBeUndefined();
  });
  it("reports missing inputs, and computes no alert on null values", () => {
    const alerts = hotelAlerts(hotelKpis({ ...month, nombreChambres: 0, revenusTotaux: 0 }), { missing: ["Commissions OTA"] });
    expect(alerts).toEqual([{ code: "INPUT_MISSING", level: "missing", message: "Donnée manquante : Commissions OTA." }]);
  });
  it("never reports an annex bonus when there is no room revenue", () => {
    expect(codes({ caChambres: 0 })).not.toContain("ANNEXES_STRONG");
  });
});

describe("CPRA", () => {
  it("weights long stays: PASS + long stay × factor", () => {
    expect(basePonderee(80, 20, 1.1)).toBeCloseTo(102, 10);
  });
  it("applies the product norm and the non-user rate (the client's PH example)", () => {
    // PH: (1 − 0.15) × 1 × (PASS + LONG × 1.1)
    expect(cpra({ normPerClient: 1, nonUserRate: 0.15, clientsPass: 80, clientsLongSejour: 20, longStayFactor: 1.1 })).toBeCloseTo(86.7, 10);
  });
  it("applies the norm even when it is not 1 (the client's file 02 ignores it)", () => {
    expect(cpra({ normPerClient: 2, nonUserRate: 0.15, clientsPass: 80, clientsLongSejour: 20, longStayFactor: 1.1 })).toBeCloseTo(173.4, 10);
  });
  it("uses no reduction for bleach and gel (non-user rate 0)", () => {
    expect(cpra({ normPerClient: 10, nonUserRate: 0, clientsPass: 100, clientsLongSejour: 0, longStayFactor: 1.1 })).toBe(1000);
  });
});

describe("CPRO", () => {
  it("sums quantity × conversion factor over the lines", () => {
    expect(cpro([{ quantite: 2, facteur: 4000 }, { quantite: 1.5, facteur: 4000 }])).toEqual({ value: 14_000, status: "OK" });
  });
  it("is null with a missing conversion on at least one line, never a partial sum", () => {
    expect(cpro([{ quantite: 2, facteur: 4000 }, { quantite: 1, facteur: null }])).toEqual({ value: null, status: "CONVERSION_MANQUANTE" });
    expect(cpro([{ quantite: 1, facteur: undefined }])).toEqual({ value: null, status: "CONVERSION_MANQUANTE" });
    expect(cpro([{ quantite: 1, facteur: Number.NaN }])).toEqual({ value: null, status: "CONVERSION_MANQUANTE" });
  });
  it("is missing, not zero, when nothing was delivered", () => {
    expect(cpro([])).toEqual({ value: null, status: "CPRO_MANQUANT" });
  });
});

describe("consumableResult — statuses and gaps", () => {
  const at = (coveragePct: number, extra: { coutUnitaire?: number | null } = {}) => consumableResult({ cpra: 100, cpro: { value: coveragePct, status: "OK" }, ...extra });

  it("follows the client's thresholds, lower bounds included", () => {
    expect(at(79.9).status).toBe("SOUS_FORTE");
    expect(at(80).status).toBe("SOUS");
    expect(at(94.9).status).toBe("SOUS");
    expect(at(95).status).toBe("CONFORME");
    expect(at(105).status).toBe("CONFORME");
    expect(at(105.1).status).toBe("SUR");
    expect(at(120).status).toBe("SUR");
    expect(at(120.1).status).toBe("SUR_FORTE");
  });
  it("gives a positive gap for over-distribution and the coverage in percent", () => {
    const r = at(110);
    expect(r.ecartVolume).toBeCloseTo(10, 10);
    expect(r.couverturePct).toBeCloseTo(110, 10);
    expect(at(90).ecartVolume).toBeCloseTo(-10, 10);
  });
  it("values the gap in whole FCFA", () => {
    expect(at(110, { coutUnitaire: 250.4 }).ecartValorise).toBe(2504);
    expect(at(110, { coutUnitaire: 33.33 }).ecartValorise).toBe(333);
    expect(at(110, { coutUnitaire: null }).ecartValorise).toBeNull();
    expect(at(110).ecartValorise).toBeNull();
  });
  it("is « N/A » when the expected quantity is zero, with no coverage", () => {
    const r = consumableResult({ cpra: 0, cpro: { value: 5, status: "OK" } });
    expect(r).toMatchObject({ status: "NA", couverturePct: null, ecartValorise: null, ecartVolume: 5 });
  });
  it("computes no gap on a missing conversion or a missing CPRO", () => {
    expect(consumableResult({ cpra: 100, cpro: cpro([{ quantite: 1, facteur: null }]), coutUnitaire: 10 })).toMatchObject({ status: "CONVERSION_MANQUANTE", ecartVolume: null, couverturePct: null, ecartValorise: null });
    expect(consumableResult({ cpra: 100, cpro: cpro([]), coutUnitaire: 10 })).toMatchObject({ status: "CPRO_MANQUANT", ecartVolume: null, ecartValorise: null });
  });
  it("accepts per-client bounds", () => {
    const strict = { strongUnder: 90, under: 98, overFrom: 102, strongOver: 110 };
    const r = consumableResult({ cpra: 100, cpro: { value: 96, status: "OK" } }, strict);
    expect(r.status).toBe("SOUS");
    expect(DEFAULT_COVERAGE_BOUNDS).toEqual({ strongUnder: 80, under: 95, overFrom: 105, strongOver: 120 });
  });
  it("chains CPRA, CPRO and status end to end", () => {
    const expected = cpra({ normPerClient: 1, nonUserRate: 0.15, clientsPass: 80, clientsLongSejour: 20, longStayFactor: 1.1 }); // 86.7
    const delivered = cpro([{ quantite: 90, facteur: 1 }]);
    const r = consumableResult({ cpra: expected, cpro: delivered, coutUnitaire: 100 });
    expect(r.status).toBe("CONFORME"); // 90 / 86.7 = 103.8 %
    expect(r.ecartVolume).toBeCloseTo(3.3, 10);
    expect(r.ecartValorise).toBe(330);
  });
});
