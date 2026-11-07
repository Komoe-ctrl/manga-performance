import type { CostPostId, DemoHotelMonth, DemoRecord } from "@/lib/services";
import { aggregate } from "./compute";

/** Un écart supérieur à ce seuil (en %) entre le prévu et le pratiqué est dit « significatif ». */
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

/** Prévu et pratiqué par poste, pour le graphique « budget contre réel ». */
export function budgetVsActual(gaps: { post: string; cpro: number; cpra: number }[]) {
  return gaps.map((g) => ({ post: g.post, prevu: g.cpro, reel: g.cpra }));
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

export type InsightLevel = "alerte" | "vigilance" | "positif";
export interface Insight {
  level: InsightLevel;
  title: string;
  detail: string;
}

const fcfa = (v: number) => `${Math.round(Math.abs(v)).toLocaleString("fr-FR").replace(/ /g, " ")} FCFA`;
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;

interface Totals {
  marginRate: number;
  satisfaction: number;
  breakEvenReached: boolean;
}

/**
 * Lecture automatique des chiffres, comme le ferait un contrôleur de gestion : ce qui se dégrade,
 * ce qui va bien, où regarder en premier. Règles simples et affichées dans la méthodologie.
 */
export function buildInsights(input: {
  cur: Totals;
  prev: Totals;
  gaps: { post: string; gap: number; gapPct: number }[];
  hotels: { hotel: string; marge: number }[];
  scopeIsAllHotels: boolean;
}): Insight[] {
  const { cur, prev, gaps, hotels, scopeIsAllHotels } = input;
  const out: Insight[] = [];

  const marginDelta = cur.marginRate - prev.marginRate;
  out.push(
    marginDelta >= 0.5
      ? { level: "positif", title: "Marge brute en amélioration", detail: `${pct(cur.marginRate)}, soit ${pct(marginDelta).replace(" %", "")} pt de plus que la période précédente.` }
      : marginDelta <= -0.5
        ? { level: "alerte", title: "Marge brute en recul", detail: `${pct(cur.marginRate)}, soit ${pct(Math.abs(marginDelta)).replace(" %", "")} pt de moins que la période précédente : chercher la cause avant la prochaine clôture.` }
        : { level: "vigilance", title: "Marge brute stable", detail: `${pct(cur.marginRate)}, sans mouvement notable par rapport à la période précédente.` },
  );

  const worst = [...gaps].sort((a, b) => b.gapPct - a.gapPct)[0];
  if (worst && worst.gapPct > SIGNIFICANT_GAP_PCT) {
    out.push({ level: "alerte", title: `Dérive des charges : ${worst.post}`, detail: `${pct(worst.gapPct)} au-dessus du prévisionnel (+${fcfa(worst.gap)}). Au-delà de ${SIGNIFICANT_GAP_PCT} %, l'écart est dit significatif.` });
  } else if (worst && worst.gapPct > 3) {
    out.push({ level: "vigilance", title: `Poste à surveiller : ${worst.post}`, detail: `${pct(worst.gapPct)} au-dessus du prévisionnel : sous le seuil de ${SIGNIFICANT_GAP_PCT} %, mais la tendance est à suivre.` });
  } else {
    out.push({ level: "positif", title: "Charges maîtrisées", detail: `Aucun poste ne dépasse de plus de 3 % son prévisionnel sur la période.` });
  }

  const significant = gaps.filter((g) => g.gapPct > SIGNIFICANT_GAP_PCT).length;
  if (significant > 1) {
    out.push({ level: "alerte", title: `${significant} postes en écart significatif`, detail: "Plusieurs postes dérivent en même temps : revoir le budget et les engagements de dépenses." });
  }

  out.push(
    cur.breakEvenReached
      ? { level: "positif", title: "Point mort atteint sur la période", detail: "Le chiffre d'affaires couvre les charges fixes et variables avant la fin de la période." }
      : { level: "alerte", title: "Point mort non atteint", detail: "Le chiffre d'affaires ne couvre pas encore l'ensemble des charges sur la période." },
  );

  const satisfactionDelta = cur.satisfaction - prev.satisfaction;
  if (satisfactionDelta <= -0.2) {
    out.push({ level: "vigilance", title: "Satisfaction clients en baisse", detail: `${cur.satisfaction.toFixed(1)} / 5, en recul de ${Math.abs(satisfactionDelta).toFixed(1)} pt : à rapprocher des écarts d'entretien et de personnel.` });
  }

  if (scopeIsAllHotels && hotels.length > 1) {
    const sorted = [...hotels].sort((a, b) => a.marge - b.marge);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if (high.marge - low.marge >= 1) {
      out.push({ level: "vigilance", title: `Écart de performance entre établissements`, detail: `${low.hotel.split(" (")[0]} (${pct(low.marge)}) est en retrait de ${(high.marge - low.marge).toFixed(1).replace(".", ",")} pt sur ${high.hotel.split(" (")[0]} (${pct(high.marge)}).` });
    }
  }
  return out;
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
