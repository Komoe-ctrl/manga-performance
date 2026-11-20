import { describe, expect, it } from "vitest";
import { type NormParam, type ProductParam, computeCpra, resolveNorm } from "../src/kpi/cpra-engine";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const norm = (over: Partial<NormParam> = {}): NormParam => ({ entityId: null, validFrom: d("2026-01-01"), normPerClient: 1, nonUserRate: 0, unitCost: 100, ...over });

const ph: ProductParam = {
  id: "p-ph",
  code: "PH",
  label: "PH (Papier hygiénique)",
  referenceUnit: "unite",
  active: true,
  conversions: [
    { deliveryUnit: "Rouleau", factor: 1 },
    { deliveryUnit: "Paquet", factor: null },
  ],
  norms: [norm({ nonUserRate: 0.15, unitCost: 76.5 })],
};
const javel: ProductParam = {
  id: "p-javel",
  code: "JAVEL",
  label: "Javel",
  referenceUnit: "ml",
  active: true,
  conversions: [{ deliveryUnit: "Bidon 4 L", factor: 4000 }],
  norms: [norm({ normPerClient: 9.55, unitCost: 0.6667 })],
};

const base = { entityId: "h1", periodStart: d("2026-06-01"), longStayFactor: 1.1, population: { pass: 1000, longSejour: 200 } };

describe("resolveNorm", () => {
  const list = [norm({ validFrom: d("2026-01-01"), normPerClient: 1 }), norm({ validFrom: d("2026-05-01"), normPerClient: 2 }), norm({ validFrom: d("2026-07-01"), normPerClient: 3 })];

  it("takes the last norm whose effective date is on or before the period start", () => {
    expect(resolveNorm(list, "h1", d("2026-06-01"))?.norm.normPerClient).toBe(2);
    expect(resolveNorm(list, "h1", d("2026-05-01"))?.norm.normPerClient).toBe(2);
    expect(resolveNorm(list, "h1", d("2026-04-30"))?.norm.normPerClient).toBe(1);
    expect(resolveNorm(list, "h1", d("2026-12-01"))?.norm.normPerClient).toBe(3);
  });

  it("returns null before the first effective date", () => {
    expect(resolveNorm(list, "h1", d("2025-12-31"))).toBeNull();
    expect(resolveNorm([], "h1", d("2026-06-01"))).toBeNull();
  });

  it("prefers an applicable norm of the hotel over a more recent client default", () => {
    const own = norm({ entityId: "h1", validFrom: d("2026-02-01"), normPerClient: 7 });
    expect(resolveNorm([...list, own], "h1", d("2026-06-01"))).toMatchObject({ scope: "ENTITY", norm: { normPerClient: 7 } });
    expect(resolveNorm([...list, own], "h2", d("2026-06-01"))).toMatchObject({ scope: "CLIENT", norm: { normPerClient: 2 } });
    // The hotel's norm only counts once it is in force.
    expect(resolveNorm([...list, own], "h1", d("2026-01-15"))).toMatchObject({ scope: "CLIENT", norm: { normPerClient: 1 } });
  });
});

describe("computeCpra", () => {
  it("computes CPRA, CPRO, volume gap, coverage and valued gap", () => {
    // PH: 1 x (1 - 0.15) x (1000 + 200 x 1.1) = 1037 ; delivered 1100 rolls.
    const out = computeCpra({ ...base, products: [ph], deliveries: [{ produit: "PH (Papier hygiénique)", uniteLivraison: "Rouleau", quantite: 1100 }] });
    expect(out.skipped).toEqual([]);
    const r = out.results[0]!;
    expect(r.cpra).toBeCloseTo(1037, 6);
    expect(r.cpro).toBe(1100);
    expect(r.ecartVolume).toBeCloseTo(63, 6);
    expect(r.couverturePct).toBeCloseTo(106.0752, 3);
    expect(r.status).toBe("SUR");
    expect(r.ecartValorise).toBe(4820); // 63 x 76.5 = 4819.5, rounded once at the end
    expect(out.totalEcartValorise).toBe(4820);
  });

  it("works in ml with fractional unit costs and rounds only the final valued gap", () => {
    // Javel: 9.55 x 1220 = 11651 ml ; 3 bidons of 4 L = 12000 ml ; gap 349 ml x 0.6667 = 232.67 -> 233.
    const r = computeCpra({ ...base, products: [javel], deliveries: [{ produit: "Javel", uniteLivraison: "Bidon 4 L", quantite: 3 }] }).results[0]!;
    expect(r.cpra).toBeCloseTo(11651, 6);
    expect(r.cpro).toBe(12000);
    expect(r.ecartValorise).toBe(233);
    expect(r.status).toBe("CONFORME");
  });

  it("sums several deliveries of the same product, whatever the unit", () => {
    const r = computeCpra({
      ...base,
      products: [{ ...ph, conversions: [{ deliveryUnit: "Rouleau", factor: 1 }, { deliveryUnit: "Paquet", factor: 12 }] }],
      deliveries: [
        { produit: "PH (Papier hygiénique)", uniteLivraison: "Paquet", quantite: 50 },
        { produit: "ph (papier hygiénique)", uniteLivraison: " rouleau ", quantite: 437 },
      ],
    }).results[0]!;
    expect(r.cpro).toBe(1037);
    expect(r.status).toBe("CONFORME");
    expect(r.ecartValorise).toBe(0);
  });

  it("does not compute the gap when a conversion factor is missing", () => {
    const r = computeCpra({ ...base, products: [ph], deliveries: [{ produit: "PH (Papier hygiénique)", uniteLivraison: "Paquet", quantite: 50 }] }).results[0]!;
    expect(r).toMatchObject({ status: "CONVERSION_MANQUANTE", cpro: null, ecartVolume: null, couverturePct: null, ecartValorise: null });
    expect(r.cpra).toBeCloseTo(1037, 6);
    // Even one unconverted line makes the whole product unusable: no half-computed total.
    const mixed = computeCpra({
      ...base,
      products: [ph],
      deliveries: [
        { produit: "PH (Papier hygiénique)", uniteLivraison: "Rouleau", quantite: 1000 },
        { produit: "PH (Papier hygiénique)", uniteLivraison: "Paquet", quantite: 5 },
      ],
    }).results[0]!;
    expect(mixed.status).toBe("CONVERSION_MANQUANTE");
  });

  it("treats a unit missing from the conversion table as a missing conversion", () => {
    const r = computeCpra({ ...base, products: [javel], deliveries: [{ produit: "Javel", uniteLivraison: "Fût 20 L", quantite: 1 }] }).results[0]!;
    expect(r.status).toBe("CONVERSION_MANQUANTE");
  });

  it("flags a product without any delivery as missing CPRO, and keeps the total clean", () => {
    const out = computeCpra({ ...base, products: [ph, javel], deliveries: [{ produit: "Javel", uniteLivraison: "Bidon 4 L", quantite: 3 }] });
    const missing = out.results.find((x) => x.productCode === "PH")!;
    expect(missing).toMatchObject({ status: "CPRO_MANQUANT", cpro: null, ecartValorise: null });
    expect(out.totalEcartValorise).toBe(233);
  });

  it("skips a product with no applicable norm instead of inventing a CPRA, and ignores inactive ones", () => {
    const early = { ...base, periodStart: d("2025-06-01") };
    const out = computeCpra({ ...early, products: [ph, { ...javel, active: false }], deliveries: [] });
    expect(out.results).toEqual([]);
    expect(out.skipped).toEqual([{ productId: "p-ph", productCode: "PH", reason: "NORME_MANQUANTE" }]);
  });

  it("gives N/A when the expected consumption is zero", () => {
    const r = computeCpra({ ...base, population: { pass: 0, longSejour: 0 }, products: [javel], deliveries: [{ produit: "Javel", uniteLivraison: "Bidon 4 L", quantite: 1 }] }).results[0]!;
    expect(r.status).toBe("NA");
    expect(r.ecartValorise).toBeNull();
  });

  it("applies the PH norm even when it differs from 1 (the client's Excel ignores it)", () => {
    const two = { ...ph, norms: [norm({ normPerClient: 2, nonUserRate: 0.15 })] };
    expect(computeCpra({ ...base, products: [two], deliveries: [] }).results[0]!.cpra).toBeCloseTo(2074, 6);
  });

  it("uses custom coverage bounds and records everything it used in the snapshot", () => {
    const bounds = { strongUnder: 50, under: 90, overFrom: 110, strongOver: 150 };
    const r = computeCpra({ ...base, bounds, products: [ph], deliveries: [{ produit: "PH (Papier hygiénique)", uniteLivraison: "Rouleau", quantite: 1100 }] }).results[0]!;
    expect(r.status).toBe("CONFORME"); // 106 % is inside the widened band
    expect(r.snapshot).toMatchObject({
      norm: { scope: "CLIENT", normPerClient: 1, nonUserRate: 0.15, unitCost: 76.5, validFrom: "2026-01-01T00:00:00.000Z" },
      longStayFactor: 1.1,
      population: { pass: 1000, longSejour: 200 },
      lines: [{ deliveryUnit: "Rouleau", quantite: 1100, factor: 1 }],
      bounds,
    });
  });

  it("is a pure function: the same input gives the same output", () => {
    const input = { ...base, products: [ph, javel], deliveries: [{ produit: "Javel", uniteLivraison: "Bidon 4 L", quantite: 3 }] };
    expect(JSON.stringify(computeCpra(input))).toBe(JSON.stringify(computeCpra(input)));
  });
});
