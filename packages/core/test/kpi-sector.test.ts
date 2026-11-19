import { describe, expect, it } from "vitest";
import {
  aggregateRatio,
  churnLevel,
  costDriftLevel,
  foodCostLevel,
  grossMarginLevel,
  laborCostLevel,
  ltvCacLevel,
  progressGapLevel,
  ratio,
  restaurantKpis,
  runwayLevel,
  siteKpis,
  stockVariationLevel,
  storeKpis,
  techKpis,
} from "../src/kpi/sector";

describe("ratio", () => {
  it("returns null on a zero denominator or a missing operand", () => {
    expect(ratio(10, 0)).toBeNull();
    expect(ratio(null, 5)).toBeNull();
    expect(ratio(5, undefined)).toBeNull();
    expect(ratio(10, 4)).toBe(2.5);
  });
});

describe("restaurant", () => {
  const k = restaurantKpis({ caHt: 10_000_000, coutMatieres: 3_000_000, chargesPersonnel: 2_500_000, autresCharges: 2_000_000, nombreCouverts: 1_000 });
  it("computes food, labor and prime cost and the result", () => {
    expect(k.foodCostPct).toBe(30);
    expect(k.laborCostPct).toBe(25);
    expect(k.primeCostPct).toBe(55);
    expect(k.resultat).toBe(2_500_000);
    expect(k.margePct).toBe(25);
    expect(k.ticketMoyen).toBe(10_000);
  });
  it("shows no average ticket without covers and no ratio without revenue", () => {
    expect(restaurantKpis({ caHt: 5, coutMatieres: 1, chargesPersonnel: 1, autresCharges: 1 }).ticketMoyen).toBeNull();
    expect(restaurantKpis({ caHt: 0, coutMatieres: 1, chargesPersonnel: 1, autresCharges: 1 }).foodCostPct).toBeNull();
  });
  it("applies the client thresholds at their boundaries", () => {
    expect([foodCostLevel(32), foodCostLevel(32.1), foodCostLevel(38), foodCostLevel(38.1), foodCostLevel(null)]).toEqual(["ok", "watch", "watch", "alert", null]);
    expect([laborCostLevel(28), laborCostLevel(35), laborCostLevel(35.1)]).toEqual(["ok", "watch", "alert"]);
  });
});

describe("store", () => {
  const k = storeKpis({ caHt: 20_000_000, achats: 10_000_000, stockDebut: 4_000_000, stockFin: 6_000_000, chargesExploitation: 3_000_000, nombreTransactions: 2_000, jours: 30 });
  it("derives the cost of sales from the stock variation", () => {
    expect(k.coutVentes).toBe(8_000_000);
    expect(k.margeBrutePct).toBe(60);
    expect(k.resultat).toBe(9_000_000);
    expect(k.margeNettePct).toBe(45);
  });
  it("rotates stock on the cost of sales, not on revenue", () => {
    expect(k.rotationStocks).toBe(1.6);
    expect(k.joursStock).toBeCloseTo(18.75);
    expect(k.panierMoyen).toBe(10_000);
    expect(k.variationStockPct).toBe(150);
  });
  it("returns null instead of Infinity when nothing was sold", () => {
    const empty = storeKpis({ caHt: 0, achats: 0, stockDebut: 100, stockFin: 100, chargesExploitation: 0, jours: 30 });
    expect(empty.rotationStocks).toBe(0);
    expect(empty.joursStock).toBeNull();
    expect(empty.margeBrutePct).toBeNull();
  });
  it("applies the thresholds", () => {
    expect([grossMarginLevel(25), grossMarginLevel(15), grossMarginLevel(14.9)]).toEqual(["ok", "watch", "alert"]);
    expect([stockVariationLevel(70), stockVariationLevel(130), stockVariationLevel(69), stockVariationLevel(131)]).toEqual(["ok", "ok", "watch", "watch"]);
  });
});

describe("construction site", () => {
  it("measures the drift against the earned value, not the total budget", () => {
    // 40 % done, 60 % of the budget spent: the total-budget view would say "within budget".
    const k = siteKpis({ budgetInitial: 100_000_000, coutsReelsCumules: 60_000_000, avancementPhysique: 40, avancementFinancier: 55, caFacture: 70_000_000, prixMarche: 125_000_000 });
    expect(k.ecartBudgetTotal).toBe(-40_000_000);
    expect(k.earnedValue).toBe(40_000_000);
    expect(k.derive).toBe(20_000_000);
    expect(k.derivePct).toBe(50);
    expect(costDriftLevel(k.derivePct)).toBe("alert");
    expect(k.cpi).toBeCloseTo(0.6667, 4);
    expect(k.coutATerminaison).toBe(150_000_000);
    expect(k.ecartAvancement).toBe(15);
    expect(progressGapLevel(k.ecartAvancement)).toBe("ok");
    expect(k.margePrevuePct).toBe(20);
    expect(k.margeReelleAdatePct).toBeCloseTo(14.2857, 4);
  });
  it("has no drift percentage before any physical progress", () => {
    const k = siteKpis({ budgetInitial: 100, coutsReelsCumules: 10, avancementPhysique: 0, avancementFinancier: 0, caFacture: 0, prixMarche: 120 });
    expect(k.derivePct).toBeNull();
    expect(k.cpi).toBe(0);
    expect(k.coutATerminaison).toBeNull();
    expect(k.margeReelleAdatePct).toBeNull();
  });
  it("applies the drift thresholds", () => {
    expect([costDriftLevel(0), costDriftLevel(10), costDriftLevel(10.1), costDriftLevel(null)]).toEqual(["ok", "watch", "alert", null]);
    expect(progressGapLevel(16)).toBe("watch");
  });
});

describe("tech / fintech", () => {
  const base = { mrrDebut: 100_000_000, mrrFin: 110_000_000, mrrPerdu: 3_000_000, clientsDebut: 1_000, clientsPerdus: 40, nouveauxClients: 100, depensesAcquisition: 30_000_000, margeBrutePct: 80, tpv: 900_000_000, revenuTransactions: 9_000_000, encaissementsTotaux: 120_000_000, decaissementsTotaux: 150_000_000, tresorerieFin: 240_000_000 };
  const k = techKpis(base);
  it("computes churn, CAC, ARPA and LTV from the raw data", () => {
    expect(k.clientsFin).toBe(1_060);
    expect(k.churnClientsPct).toBe(4);
    expect(k.churnMrrPct).toBe(3);
    expect(k.cac).toBe(300_000);
    expect(k.arpa).toBeCloseTo(103_773.58, 2);
    expect(k.ltv).toBeCloseTo(2_075_471.7, 1);
    expect(k.ltvCac).toBeCloseTo(6.918, 3);
    expect(k.takeRatePct).toBe(1);
  });
  it("computes the net burn and the runway only when cash is being burnt", () => {
    expect(k.burnNet).toBe(30_000_000);
    expect(k.runwayMois).toBe(8);
    const profitable = techKpis({ ...base, encaissementsTotaux: 200_000_000 });
    expect(profitable.burnNet).toBeNull();
    expect(profitable.runwayMois).toBeNull();
  });
  it("never returns an infinite LTV when churn is zero or margin is missing", () => {
    expect(techKpis({ ...base, clientsPerdus: 0 }).ltv).toBeNull();
    expect(techKpis({ ...base, margeBrutePct: null }).ltv).toBeNull();
    expect(techKpis({ ...base, nouveauxClients: 0 }).cac).toBeNull();
  });
  it("lets the treasury go negative", () => {
    expect(techKpis({ ...base, tresorerieFin: -5_000_000 }).runwayMois).toBeLessThan(0);
  });
  it("applies the thresholds", () => {
    expect([churnLevel(5), churnLevel(7), churnLevel(7.1)]).toEqual(["ok", "watch", "alert"]);
    expect([ltvCacLevel(3), ltvCacLevel(2), ltvCacLevel(1.9)]).toEqual(["ok", "watch", "alert"]);
    expect([runwayLevel(12), runwayLevel(6), runwayLevel(5.9)]).toEqual(["ok", "watch", "alert"]);
  });
});

describe("aggregation", () => {
  it("is a ratio of totals, not an average of ratios", () => {
    // 10 % of 1 000 and 50 % of 100: the average of ratios says 30 %, the group says 13,6 %.
    expect(aggregateRatio([{ numerator: 100, denominator: 1_000 }, { numerator: 50, denominator: 100 }])).toBeCloseTo(0.13636, 4);
    expect(aggregateRatio([])).toBeNull();
  });
});
