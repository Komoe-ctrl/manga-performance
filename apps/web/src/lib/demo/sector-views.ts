import {
  churnLevel,
  costDriftLevel,
  foodCostLevel,
  grossMarginLevel,
  laborCostLevel,
  ltvCacLevel,
  progressGapLevel,
  restaurantKpis,
  runwayLevel,
  siteKpis,
  stockVariationLevel,
  storeKpis,
  techKpis,
  type Level,
  type SiteInput,
} from "@manga/core/kpi/sector";
import { formatFCFA } from "@/lib/utils/format";

/* Données entièrement fictives (avenant n°1 : jamais de donnée réelle du client). Les KPI viennent de @manga/core/kpi. */

export type SectorTabId = "restauration" | "commerce" | "btp" | "tech";

export interface DemoKpi {
  label: string;
  value: string;
  /** Variation vs mois précédent, déjà formatée (« +1,2 pt »). */
  delta?: string;
  level?: Level | null;
  hint?: string;
}
export interface DemoAlert {
  level: Level;
  text: string;
}
export interface SectorView {
  id: SectorTabId;
  title: string;
  kpis: DemoKpi[];
  trend: { title: string; unit: "pct" | "fcfa" | "mois" | "nombre"; series: { key: string; label: string; color: string }[]; data: Record<string, string | number | null>[] };
  analysis: { title: string; columns: string[]; rows: string[][] };
  alerts: DemoAlert[];
}

const MONTHS = ["Avr.", "Mai", "Juin", "Juil.", "Août", "Sept."];
const NAVY = "#1A2B4A";
const GOLD = "#C98F00";

const fr = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
export const pctText = (v: number | null, d = 1) => (v === null ? "—" : `${fr(v, d)} %`);
export const numText = (v: number | null, d = 1) => (v === null ? "—" : fr(v, d));
export const fcfaText = (v: number | null) => (v === null ? "—" : formatFCFA(Math.round(v)));
const delta = (cur: number | null, prev: number | null, unit: string, d = 1) =>
  cur === null || prev === null ? undefined : `${cur - prev >= 0 ? "+" : "−"}${fr(Math.abs(cur - prev), d)} ${unit} vs mois préc.`;
const last = <T,>(a: T[]) => a[a.length - 1];
const prev = <T,>(a: T[]) => a[a.length - 2];
const alertFor = (level: Level | null | undefined, text: string): DemoAlert[] => (level && level !== "ok" ? [{ level, text }] : []);

/* ---------- Restauration (un établissement fictif) ---------- */
function restauration(): SectorView {
  const inputs = [
    { caHt: 17_800_000, coutMatieres: 5_500_000, chargesPersonnel: 4_700_000, autresCharges: 4_100_000, nombreCouverts: 2_850 },
    { caHt: 18_900_000, coutMatieres: 5_800_000, chargesPersonnel: 4_900_000, autresCharges: 4_200_000, nombreCouverts: 3_010 },
    { caHt: 19_600_000, coutMatieres: 6_300_000, chargesPersonnel: 5_100_000, autresCharges: 4_250_000, nombreCouverts: 3_080 },
    { caHt: 20_400_000, coutMatieres: 7_050_000, chargesPersonnel: 5_300_000, autresCharges: 4_300_000, nombreCouverts: 3_120 },
    { caHt: 19_900_000, coutMatieres: 7_300_000, chargesPersonnel: 5_650_000, autresCharges: 4_350_000, nombreCouverts: 3_040 },
    { caHt: 21_200_000, coutMatieres: 8_000_000, chargesPersonnel: 5_900_000, autresCharges: 4_400_000, nombreCouverts: 3_180 },
  ];
  const k = inputs.map(restaurantKpis);
  const c = last(k), p = prev(k);
  return {
    id: "restauration",
    title: "Restaurant fictif « Le Banian »",
    kpis: [
      { label: "CA HT du mois", value: fcfaText(last(inputs).caHt), delta: delta(last(inputs).caHt / 1e6, prev(inputs).caHt / 1e6, "M FCFA") },
      { label: "Food cost", value: pctText(c.foodCostPct), delta: delta(c.foodCostPct, p.foodCostPct, "pt"), level: foodCostLevel(c.foodCostPct), hint: "Objectif ≤ 32 %" },
      { label: "Labor cost", value: pctText(c.laborCostPct), delta: delta(c.laborCostPct, p.laborCostPct, "pt"), level: laborCostLevel(c.laborCostPct), hint: "Objectif ≤ 28 %" },
      { label: "Marge d'exploitation", value: pctText(c.margePct), delta: delta(c.margePct, p.margePct, "pt") },
    ],
    trend: { title: "Food cost et labor cost (% du CA)", unit: "pct", series: [{ key: "food", label: "Food cost", color: NAVY }, { key: "labor", label: "Labor cost", color: GOLD }], data: k.map((x, i) => ({ mois: MONTHS[i], food: x.foodCostPct === null ? null : +x.foodCostPct.toFixed(1), labor: x.laborCostPct === null ? null : +x.laborCostPct.toFixed(1) })) },
    analysis: {
      title: "Structure du compte d'exploitation (mois en cours)",
      columns: ["Poste", "Montant", "% du CA"],
      rows: [
        ["Coût matières", fcfaText(last(inputs).coutMatieres), pctText(c.foodCostPct)],
        ["Charges de personnel", fcfaText(last(inputs).chargesPersonnel), pctText(c.laborCostPct)],
        ["Autres charges", fcfaText(last(inputs).autresCharges), pctText((last(inputs).autresCharges / last(inputs).caHt) * 100)],
        ["Résultat d'exploitation", fcfaText(c.resultat), pctText(c.margePct)],
        ["Ticket moyen", fcfaText(c.ticketMoyen), "—"],
      ],
    },
    alerts: [
      ...alertFor(foodCostLevel(c.foodCostPct), `Food cost à ${pctText(c.foodCostPct)} : au-dessus du seuil de 32 %. Vérifier les achats, les portions et les pertes.`),
      ...alertFor(laborCostLevel(c.laborCostPct), `Labor cost à ${pctText(c.laborCostPct)} : au-dessus du seuil de 28 %.`),
    ],
  };
}

/* ---------- Commerce (un magasin fictif) ---------- */
function commerce(): SectorView {
  const inputs = [
    { caHt: 31_000_000, achats: 21_000_000, stockDebut: 12_000_000, stockFin: 12_500_000, chargesExploitation: 5_200_000, nombreTransactions: 6_200 },
    { caHt: 32_500_000, achats: 22_400_000, stockDebut: 12_500_000, stockFin: 13_000_000, chargesExploitation: 5_300_000, nombreTransactions: 6_450 },
    { caHt: 30_200_000, achats: 21_800_000, stockDebut: 13_000_000, stockFin: 14_800_000, chargesExploitation: 5_300_000, nombreTransactions: 6_000 },
    { caHt: 33_800_000, achats: 25_000_000, stockDebut: 14_800_000, stockFin: 15_100_000, chargesExploitation: 5_450_000, nombreTransactions: 6_600 },
    { caHt: 34_100_000, achats: 26_100_000, stockDebut: 15_100_000, stockFin: 16_300_000, chargesExploitation: 5_500_000, nombreTransactions: 6_520 },
    { caHt: 35_400_000, achats: 25_600_000, stockDebut: 16_300_000, stockFin: 9_800_000, chargesExploitation: 5_600_000, nombreTransactions: 6_700 },
  ].map((x) => ({ ...x, jours: 30 }));
  const k = inputs.map(storeKpis);
  const c = last(k), p = prev(k);
  return {
    id: "commerce",
    title: "Magasin fictif « Boutique Centre »",
    kpis: [
      { label: "CA HT du mois", value: fcfaText(last(inputs).caHt), delta: delta(last(inputs).caHt / 1e6, prev(inputs).caHt / 1e6, "M FCFA") },
      { label: "Marge brute", value: pctText(c.margeBrutePct), delta: delta(c.margeBrutePct, p.margeBrutePct, "pt"), level: grossMarginLevel(c.margeBrutePct), hint: "Objectif ≥ 25 %" },
      { label: "Rotation des stocks", value: numText(c.rotationStocks), delta: delta(c.rotationStocks, p.rotationStocks, "", 1), hint: "Coût des ventes / stock moyen" },
      { label: "Marge nette", value: pctText(c.margeNettePct), delta: delta(c.margeNettePct, p.margeNettePct, "pt") },
    ],
    trend: { title: "Marge brute et marge nette (% du CA)", unit: "pct", series: [{ key: "brute", label: "Marge brute", color: NAVY }, { key: "nette", label: "Marge nette", color: GOLD }], data: k.map((x, i) => ({ mois: MONTHS[i], brute: x.margeBrutePct === null ? null : +x.margeBrutePct.toFixed(1), nette: x.margeNettePct === null ? null : +x.margeNettePct.toFixed(1) })) },
    analysis: {
      title: "Stock et coût des ventes (mois en cours)",
      columns: ["Indicateur", "Valeur"],
      rows: [
        ["Stock début", fcfaText(last(inputs).stockDebut)],
        ["+ Achats du mois", fcfaText(last(inputs).achats)],
        ["− Stock fin", fcfaText(last(inputs).stockFin)],
        ["= Coût des ventes", fcfaText(c.coutVentes)],
        ["Jours de stock", `${numText(c.joursStock, 0)} j`],
        ["Panier moyen", fcfaText(c.panierMoyen)],
      ],
    },
    alerts: [
      ...alertFor(stockVariationLevel(c.variationStockPct), `Stock fin à ${pctText(c.variationStockPct, 0)} du stock début : forte baisse. Réassort à vérifier, risque de rupture.`),
      ...alertFor(grossMarginLevel(c.margeBrutePct), `Marge brute à ${pctText(c.margeBrutePct)} : sous le seuil de 25 %.`),
    ],
  };
}

/* ---------- BTP (quatre chantiers fictifs, un fichier) ---------- */
function btp(): SectorView {
  const sites: { code: string; name: string; input: SiteInput }[] = [
    { code: "CH-101", name: "Résidence Les Flamboyants", input: { budgetInitial: 480_000_000, coutsReelsCumules: 212_000_000, avancementPhysique: 45, avancementFinancier: 44, caFacture: 255_000_000, prixMarche: 560_000_000 } },
    { code: "CH-102", name: "Entrepôt logistique Nord", input: { budgetInitial: 320_000_000, coutsReelsCumules: 205_000_000, avancementPhysique: 40, avancementFinancier: 52, caFacture: 190_000_000, prixMarche: 375_000_000 } },
    { code: "CH-103", name: "Voirie du quartier Est", input: { budgetInitial: 150_000_000, coutsReelsCumules: 96_000_000, avancementPhysique: 70, avancementFinancier: 66, caFacture: 120_000_000, prixMarche: 176_000_000 } },
    { code: "CH-104", name: "École primaire (extension)", input: { budgetInitial: 210_000_000, coutsReelsCumules: 70_000_000, avancementPhysique: 30, avancementFinancier: 28, caFacture: 82_000_000, prixMarche: 246_000_000 } },
  ];
  const k = sites.map((s) => ({ ...s, k: siteKpis(s.input) }));
  const worst = [...k].sort((a, b) => (b.k.derivePct ?? -Infinity) - (a.k.derivePct ?? -Infinity))[0];
  // Évolution de la dérive du chantier le plus tendu (mêmes chiffres fictifs, 6 mois).
  const driftSeries = [6.2, 14.5, 24.8, 36.1, 47.9, worst.k.derivePct ?? 0];
  return {
    id: "btp",
    title: "Agence fictive « Atlas BTP — Nord » : 4 chantiers actifs",
    kpis: [
      { label: "Budget engagé (4 chantiers)", value: fcfaText(sites.reduce((s, x) => s + x.input.budgetInitial, 0)), hint: "Somme des budgets initiaux" },
      { label: "Dérive de coûts max.", value: pctText(worst.k.derivePct), level: costDriftLevel(worst.k.derivePct), hint: `${worst.code} · coûts vs valeur acquise` },
      { label: "CPI le plus bas", value: numText(Math.min(...k.map((x) => x.k.cpi ?? Infinity)), 2), hint: "< 1 = dérive" },
      { label: "Chantiers en alerte", value: String(k.filter((x) => costDriftLevel(x.k.derivePct) === "alert").length), hint: `${k.filter((x) => costDriftLevel(x.k.derivePct) === "watch").length} à surveiller` },
    ],
    trend: { title: `Dérive de coûts de ${worst.code} (% vs valeur acquise)`, unit: "pct", series: [{ key: "derive", label: "Dérive", color: NAVY }], data: driftSeries.map((v, i) => ({ mois: MONTHS[i], derive: +v.toFixed(1) })) },
    analysis: {
      title: "Situation par chantier",
      columns: ["Chantier", "Physique", "Valeur acquise", "Coûts réels", "Dérive", "CPI", "Coût à terminaison"],
      rows: k.map((x) => [`${x.code} ${x.name}`, `${x.input.avancementPhysique} %`, fcfaText(x.k.earnedValue), fcfaText(x.input.coutsReelsCumules), pctText(x.k.derivePct), numText(x.k.cpi, 2), fcfaText(x.k.coutATerminaison)]),
    },
    alerts: k.flatMap((x) => [
      ...alertFor(costDriftLevel(x.k.derivePct), `${x.code} : les coûts dépassent la valeur acquise de ${pctText(x.k.derivePct)} (coût à terminaison estimé ${fcfaText(x.k.coutATerminaison)} pour un budget de ${fcfaText(x.input.budgetInitial)}).`),
      ...alertFor(progressGapLevel(x.k.ecartAvancement), `${x.code} : l'avancement financier dépasse le physique de ${x.k.ecartAvancement} points.`),
    ]),
  };
}

/* ---------- Tech / Fintech (une société fictive) ---------- */
function tech(): SectorView {
  const inputs = [
    { mrrDebut: 88_000_000, mrrFin: 92_000_000, mrrPerdu: 2_600_000, clientsDebut: 880, clientsPerdus: 28, nouveauxClients: 70, depensesAcquisition: 19_000_000, margeBrutePct: 78, tpv: 620_000_000, revenuTransactions: 6_000_000, encaissementsTotaux: 118_000_000, decaissementsTotaux: 128_000_000, tresorerieFin: 310_000_000 },
    { mrrDebut: 92_000_000, mrrFin: 97_000_000, mrrPerdu: 2_900_000, clientsDebut: 922, clientsPerdus: 31, nouveauxClients: 76, depensesAcquisition: 20_500_000, margeBrutePct: 78, tpv: 660_000_000, revenuTransactions: 6_400_000, encaissementsTotaux: 124_000_000, decaissementsTotaux: 133_000_000, tresorerieFin: 301_000_000 },
    { mrrDebut: 97_000_000, mrrFin: 100_500_000, mrrPerdu: 3_600_000, clientsDebut: 967, clientsPerdus: 41, nouveauxClients: 66, depensesAcquisition: 21_000_000, margeBrutePct: 77, tpv: 690_000_000, revenuTransactions: 6_700_000, encaissementsTotaux: 127_000_000, decaissementsTotaux: 140_000_000, tresorerieFin: 288_000_000 },
    { mrrDebut: 100_500_000, mrrFin: 103_000_000, mrrPerdu: 4_900_000, clientsDebut: 992, clientsPerdus: 58, nouveauxClients: 62, depensesAcquisition: 23_500_000, margeBrutePct: 76, tpv: 700_000_000, revenuTransactions: 6_800_000, encaissementsTotaux: 130_000_000, decaissementsTotaux: 150_000_000, tresorerieFin: 268_000_000 },
    { mrrDebut: 103_000_000, mrrFin: 104_200_000, mrrPerdu: 6_300_000, clientsDebut: 996, clientsPerdus: 72, nouveauxClients: 60, depensesAcquisition: 27_000_000, margeBrutePct: 76, tpv: 705_000_000, revenuTransactions: 6_800_000, encaissementsTotaux: 131_000_000, decaissementsTotaux: 158_000_000, tresorerieFin: 241_000_000 },
    { mrrDebut: 104_200_000, mrrFin: 105_000_000, mrrPerdu: 7_400_000, clientsDebut: 984, clientsPerdus: 79, nouveauxClients: 58, depensesAcquisition: 29_500_000, margeBrutePct: 75, tpv: 710_000_000, revenuTransactions: 6_900_000, encaissementsTotaux: 133_000_000, decaissementsTotaux: 171_000_000, tresorerieFin: 203_000_000 },
  ];
  const k = inputs.map(techKpis);
  const c = last(k), p = prev(k);
  return {
    id: "tech",
    title: "Société fictive « Atlas Pay » (SaaS et paiements)",
    kpis: [
      { label: "MRR fin de mois", value: fcfaText(last(inputs).mrrFin), delta: delta(last(inputs).mrrFin / 1e6, prev(inputs).mrrFin / 1e6, "M FCFA") },
      { label: "Churn clients", value: pctText(c.churnClientsPct), delta: delta(c.churnClientsPct, p.churnClientsPct, "pt"), level: churnLevel(c.churnClientsPct), hint: "Objectif ≤ 5 %" },
      { label: "LTV / CAC", value: numText(c.ltvCac), delta: delta(c.ltvCac, p.ltvCac, ""), level: ltvCacLevel(c.ltvCac), hint: "Objectif ≥ 3" },
      { label: "Runway", value: c.runwayMois === null ? "—" : `${numText(c.runwayMois)} mois`, level: runwayLevel(c.runwayMois), hint: "Trésorerie / burn net" },
    ],
    trend: { title: "Churn clients (% mensuel)", unit: "pct", series: [{ key: "churn", label: "Churn clients", color: NAVY }], data: k.map((x, i) => ({ mois: MONTHS[i], churn: x.churnClientsPct === null ? null : +x.churnClientsPct.toFixed(1) })) },
    analysis: {
      title: "Économie unitaire et trésorerie (mois en cours)",
      columns: ["Indicateur", "Valeur"],
      rows: [
        ["Clients actifs fin de mois", String(c.clientsFin)],
        ["ARPA (MRR par client)", fcfaText(c.arpa)],
        ["CAC", fcfaText(c.cac)],
        ["LTV", fcfaText(c.ltv)],
        ["Burn net mensuel", fcfaText(c.burnNet)],
        ["Trésorerie fin de mois", fcfaText(last(inputs).tresorerieFin)],
        ["Take rate (paiements)", pctText(c.takeRatePct, 2)],
      ],
    },
    alerts: [
      ...alertFor(churnLevel(c.churnClientsPct), `Churn clients à ${pctText(c.churnClientsPct)} (seuil 5 %) : la perte de clients accélère depuis ${MONTHS[1].toLowerCase()}.`),
      ...alertFor(ltvCacLevel(c.ltvCac), `LTV/CAC à ${numText(c.ltvCac)} : l'acquisition coûte trop cher au regard de la valeur des clients.`),
      ...alertFor(runwayLevel(c.runwayMois), `Runway de ${numText(c.runwayMois)} mois au rythme de burn actuel (seuil proposé : 6 mois).`),
    ],
  };
}

export const SECTOR_VIEWS: Record<SectorTabId, () => SectorView> = { restauration, commerce, btp, tech };
