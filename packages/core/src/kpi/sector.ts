/**
 * Catalogue de formules sectorielles (avenant n°1, §11.2 et §11 quater). Fonctions pures :
 * toute division par zéro retourne `null` (l'interface affiche « — »), jamais NaN ni Infinity.
 * Les montants sont en FCFA entiers ; les ratios en pourcentage sont des nombres (31,7 = 31,7 %).
 */

export type Level = "ok" | "watch" | "alert";

/** Division sûre : `null` si le dénominateur est nul ou si un opérande est absent. */
export function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

const pct = (n: number | null | undefined, d: number | null | undefined) => {
  // Multiply before dividing: (n * 100) / d avoids the 55.00000000000001 of (n / d) * 100.
  if (n == null) return null;
  return ratio(n * 100, d);
};

/* ---------- Restauration ---------- */

export interface RestaurantInput {
  caHt: number;
  coutMatieres: number;
  chargesPersonnel: number;
  autresCharges: number;
  nombreCouverts?: number | null;
}

export function restaurantKpis(i: RestaurantInput) {
  const resultat = i.caHt - i.coutMatieres - i.chargesPersonnel - i.autresCharges;
  return {
    foodCostPct: pct(i.coutMatieres, i.caHt),
    laborCostPct: pct(i.chargesPersonnel, i.caHt),
    primeCostPct: pct(i.coutMatieres + i.chargesPersonnel, i.caHt),
    resultat,
    margePct: pct(resultat, i.caHt),
    ticketMoyen: ratio(i.caHt, i.nombreCouverts),
  };
}

/** Food cost : ≤ 32 % ok, 32–38 % à surveiller, > 38 % alerte. */
export const foodCostLevel = (v: number | null): Level | null => (v === null ? null : v <= 32 ? "ok" : v <= 38 ? "watch" : "alert");
/** Labor cost : ≤ 28 % ok, 28–35 % à surveiller, > 35 % alerte. */
export const laborCostLevel = (v: number | null): Level | null => (v === null ? null : v <= 28 ? "ok" : v <= 35 ? "watch" : "alert");

/* ---------- Commerce ---------- */

export interface StoreInput {
  caHt: number;
  achats: number;
  stockDebut: number;
  stockFin: number;
  chargesExploitation: number;
  nombreTransactions?: number | null;
  /** Nombre de jours de la période (pour les jours de stock). */
  jours?: number;
}

export function storeKpis(i: StoreInput) {
  const coutVentes = i.stockDebut + i.achats - i.stockFin;
  const stockMoyen = (i.stockDebut + i.stockFin) / 2;
  const resultat = i.caHt - coutVentes - i.chargesExploitation;
  const rotation = ratio(coutVentes, stockMoyen);
  return {
    coutVentes,
    margeBrutePct: pct(i.caHt - coutVentes, i.caHt),
    rotationStocks: rotation,
    joursStock: i.jours === undefined ? null : ratio(stockMoyen * i.jours, coutVentes),
    resultat,
    margeNettePct: pct(resultat, i.caHt),
    panierMoyen: ratio(i.caHt, i.nombreTransactions),
    variationStockPct: pct(i.stockFin, i.stockDebut),
  };
}

/** Marge brute : ≥ 25 % ok, 15–25 % à surveiller, < 15 % alerte. */
export const grossMarginLevel = (v: number | null): Level | null => (v === null ? null : v >= 25 ? "ok" : v >= 15 ? "watch" : "alert");
/** Variation de stock (fin / début) : 70–130 % ok, en dehors à surveiller. */
export const stockVariationLevel = (v: number | null): Level | null => (v === null ? null : v >= 70 && v <= 130 ? "ok" : "watch");

/* ---------- BTP ---------- */

export interface SiteInput {
  budgetInitial: number;
  coutsReelsCumules: number;
  /** 0–100 */
  avancementPhysique: number;
  /** 0–100 */
  avancementFinancier: number;
  caFacture: number;
  prixMarche: number;
}

/** Dérive mesurée sur la valeur acquise (budget × avancement physique), pas sur le budget total. */
export function siteKpis(i: SiteInput) {
  const earnedValue = Math.round((i.budgetInitial * i.avancementPhysique) / 100);
  const cpi = ratio(earnedValue, i.coutsReelsCumules);
  return {
    ecartBudgetTotal: i.coutsReelsCumules - i.budgetInitial,
    earnedValue,
    derive: i.coutsReelsCumules - earnedValue,
    derivePct: pct(i.coutsReelsCumules - earnedValue, earnedValue),
    cpi,
    coutATerminaison: cpi === null || cpi === 0 ? null : Math.round(i.budgetInitial / cpi),
    ecartAvancement: Math.abs(i.avancementPhysique - i.avancementFinancier),
    margePrevuePct: pct(i.prixMarche - i.budgetInitial, i.prixMarche),
    margeReelleAdatePct: pct(i.caFacture - i.coutsReelsCumules, i.caFacture),
  };
}

/** Dérive de coûts : ≤ 0 % ok, 0–10 % à surveiller, > 10 % alerte. */
export const costDriftLevel = (v: number | null): Level | null => (v === null ? null : v <= 0 ? "ok" : v <= 10 ? "watch" : "alert");
/** Écart avancement physique / financier : ≤ 15 points ok, au-delà à surveiller. */
export const progressGapLevel = (points: number): Level => (points <= 15 ? "ok" : "watch");

/* ---------- Tech / Fintech ---------- */

export interface TechInput {
  mrrDebut: number;
  mrrFin: number;
  mrrPerdu: number;
  clientsDebut: number;
  clientsPerdus: number;
  nouveauxClients: number;
  depensesAcquisition: number;
  /** 0–100 ; absent : LTV non calculable. */
  margeBrutePct?: number | null;
  tpv?: number | null;
  revenuTransactions?: number | null;
  encaissementsTotaux?: number;
  decaissementsTotaux?: number;
  tresorerieFin?: number;
}

export function techKpis(i: TechInput) {
  const clientsFin = i.clientsDebut - i.clientsPerdus + i.nouveauxClients;
  const churnClientsPct = pct(i.clientsPerdus, i.clientsDebut);
  const arpa = ratio(i.mrrFin, clientsFin);
  const cac = ratio(i.depensesAcquisition, i.nouveauxClients);
  // LTV avec un churn nul ou une marge absente : null, jamais l'infini.
  const ltv = arpa === null || i.margeBrutePct == null || churnClientsPct === null || churnClientsPct === 0 ? null : (arpa * (i.margeBrutePct / 100)) / (churnClientsPct / 100);
  const burn = i.decaissementsTotaux !== undefined && i.encaissementsTotaux !== undefined ? i.decaissementsTotaux - i.encaissementsTotaux : null;
  const burnNet = burn !== null && burn > 0 ? burn : null;
  return {
    clientsFin,
    churnClientsPct,
    churnMrrPct: pct(i.mrrPerdu, i.mrrDebut),
    cac,
    arpa,
    ltv,
    ltvCac: ratio(ltv, cac),
    burnNet,
    runwayMois: burnNet === null ? null : ratio(i.tresorerieFin, burnNet),
    takeRatePct: pct(i.revenuTransactions, i.tpv),
  };
}

/** Churn clients mensuel : ≤ 5 % ok, 5–7 % à surveiller, > 7 % alerte. */
export const churnLevel = (v: number | null): Level | null => (v === null ? null : v <= 5 ? "ok" : v <= 7 ? "watch" : "alert");
/** LTV / CAC : ≥ 3 ok, 2–3 à surveiller, < 2 alerte. */
export const ltvCacLevel = (v: number | null): Level | null => (v === null ? null : v >= 3 ? "ok" : v >= 2 ? "watch" : "alert");
/** Runway : ≥ 12 mois ok, 6–12 à surveiller, < 6 alerte (seuil proposé, à valider par le client). */
export const runwayLevel = (v: number | null): Level | null => (v === null ? null : v >= 12 ? "ok" : v >= 6 ? "watch" : "alert");

/* ---------- Agrégation ---------- */

/** Ratio agrégé = ratio des totaux, jamais moyenne de ratios (avenant §11 quater). */
export function aggregateRatio(items: { numerator: number; denominator: number }[]): number | null {
  return ratio(
    items.reduce((s, x) => s + x.numerator, 0),
    items.reduce((s, x) => s + x.denominator, 0),
  );
}
