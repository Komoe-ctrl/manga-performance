import type { CostPostId, DemoHotelMonth, DemoRecord } from "@/lib/services";
import { aggregate } from "./compute";

/** Un écart supérieur à ce seuil (en %) entre le réalisé et le budget est dit « significatif ». */
export const SIGNIFICANT_GAP_PCT = 5;

interface Source {
  months: string[];
  records: DemoRecord[];
  hotelMonths: DemoHotelMonth[];
}
type Scope = { hotelId: string; productId: string };

const inScope = (r: DemoRecord, f: Scope, set: Set<string>) =>
  set.has(r.month) && (f.hotelId === "all" || r.hotelId === f.hotelId) && (f.productId === "all" || r.productId === f.productId);

/** Répartition des charges pratiquées par poste. */
export function costMix(src: Source, f: Scope, months: string[], posts: readonly { id: CostPostId; name: string }[]) {
  const set = new Set(months);
  const records = src.records.filter((r) => inScope(r, f, set));
  const rows = posts.map((p) => ({ post: p.name, value: records.reduce((s, r) => s + r.costs[p.id].actual, 0) }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return rows.map((r) => ({ ...r, share: total ? (r.value / total) * 100 : 0 }));
}

/** Chiffre d'affaires par produit (activité), pour l'hôtel choisi. */
export function productMix(src: Source, hotelId: string, months: string[], products: readonly { id: string; name: string }[]) {
  const set = new Set(months);
  const rows = products.map((p) => ({
    product: p.name,
    ca: src.records.filter((r) => inScope(r, { hotelId, productId: p.id }, set)).reduce((s, r) => s + r.revenue, 0),
  }));
  const total = rows.reduce((s, r) => s + r.ca, 0);
  return rows.map((r) => ({ ...r, share: total ? (r.ca / total) * 100 : 0 }));
}

/** Budget et réalisé par poste, pour le graphique « budget contre réalisé ». */
export function budgetVsActual(gaps: { post: string; budget: number; actual: number }[]) {
  return gaps.map((g) => ({ post: g.post, budget: g.budget, realise: g.actual }));
}

/** Synthèse par hôtel : résultat, marge et écart au prévisionnel. */
export function hotelSummary(src: Source & { hotels: readonly { id: string; name: string }[] }, productId: string, months: string[]) {
  const rows = src.hotels.map((h) => {
    const a = aggregate(src, { hotelId: h.id, productId }, months);
    return {
      id: h.id,
      hotel: h.name,
      ca: a.revenue,
      charges: a.charges,
      resultat: a.revenue - a.charges,
      marge: a.marginRate,
      ecartBudget: a.planned ? ((a.charges - a.planned) / a.planned) * 100 : 0,
      satisfaction: a.satisfaction,
    };
  });
  return rows.sort((a, b) => b.marge - a.marge).map((r, i) => ({ ...r, rang: i + 1 }));
}

const RECOMMENDATIONS: Record<CostPostId, string> = {
  personnel: "Revoir la planification des équipes selon la fréquentation et encadrer les heures supplémentaires.",
  achats: "Renégocier les contrats fournisseurs, comparer au moins trois devis et suivre les prix d'achat chaque mois.",
  energie: "Auditer les consommations (climatisation, éclairage, eau chaude) et installer des sous-compteurs par zone.",
  entretien: "Passer d'un entretien correctif à une maintenance préventive planifiée, avec un budget par équipement.",
  marketing: "Mesurer le retour de chaque canal avant de reconduire la dépense, et couper ce qui ne convertit pas.",
  autres: "Détailler les charges diverses : toute dépense récurrente supérieure à 1 M FCFA doit avoir un poste dédié.",
};

/** Les actions à lancer en premier : les trois plus gros écarts défavorables. */
export function actionPlan(gaps: { id: CostPostId; post: string; gap: number; gapPct: number }[]) {
  return [...gaps]
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
    .map((g, i) => ({ priority: i + 1, post: g.post, impact: g.gap, gapPct: g.gapPct, action: RECOMMENDATIONS[g.id] }));
}
