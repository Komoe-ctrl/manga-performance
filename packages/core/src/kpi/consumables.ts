import { ratio } from "./sector";

/**
 * Consommables hôteliers : CPRO, CPRA, écarts et statut (avenant n°1, §11 bis).
 * Fonctions pures. Le moteur complet (paramètres historisés par date d'effet, groupe) arrive en B8 ;
 * ici, les formules et les seuils du client, avec les paramètres déjà résolus.
 *
 * Convention de signe : écart = CPRO − CPRA, positif = **sur-distribution** (avenant §11.2).
 */

export interface CpraInput {
  /** Norme de consommation par client, en unité de référence CPRA. */
  normPerClient: number;
  /** Part de la clientèle qui n'utilise pas le produit (0 à 1). PH : 0,15 ; javel et gel : 0. */
  nonUserRate: number;
  clientsPass: number;
  clientsLongSejour: number;
  /** Facteur long séjour propre à l'hôtel. */
  longStayFactor: number;
}

/** PASS + long séjour × facteur. */
export const basePonderee = (pass: number, longStay: number, longStayFactor: number): number => pass + longStay * longStayFactor;

/**
 * CPRA = norme × (1 − taux de non-utilisateurs) × base pondérée. La norme est **toujours** appliquée
 * (le fichier 02 du client l'ignore pour le PH : sans effet tant qu'elle vaut 1, faux dès qu'elle change).
 */
export function cpra(i: CpraInput): number {
  return i.normPerClient * (1 - i.nonUserRate) * basePonderee(i.clientsPass, i.clientsLongSejour, i.longStayFactor);
}

export interface DeliveryLine {
  quantite: number;
  /** Facteur vers l'unité de référence CPRA ; `null` ou absent si la conversion n'est pas configurée. */
  facteur: number | null | undefined;
}

export type CproStatus = "OK" | "CONVERSION_MANQUANTE" | "CPRO_MANQUANT";

/**
 * CPRO = Σ quantité × facteur. Une conversion manquante, même sur une seule ligne, rend le CPRO
 * `null` : on ne calcule jamais un écart sur des unités incohérentes. Sans aucune ligne, il est
 * manquant (et non nul).
 */
export function cpro(lines: readonly DeliveryLine[]): { value: number | null; status: CproStatus } {
  if (lines.length === 0) return { value: null, status: "CPRO_MANQUANT" };
  if (lines.some((l) => l.facteur == null || !Number.isFinite(l.facteur))) return { value: null, status: "CONVERSION_MANQUANTE" };
  const value = lines.reduce((sum, l) => sum + l.quantite * (l.facteur as number), 0);
  return { value, status: "OK" };
}

/** Bornes de couverture en % (paramétrables par client). */
export interface CoverageBounds {
  strongUnder: number;
  under: number;
  overFrom: number;
  strongOver: number;
}

export const DEFAULT_COVERAGE_BOUNDS: CoverageBounds = { strongUnder: 80, under: 95, overFrom: 105, strongOver: 120 };

export type CoverageStatus = "CPRO_MANQUANT" | "CONVERSION_MANQUANTE" | "NA" | "SOUS_FORTE" | "SOUS" | "CONFORME" | "SUR" | "SUR_FORTE";

export interface ConsumableResult {
  cpra: number;
  cpro: number | null;
  ecartVolume: number | null;
  couverturePct: number | null;
  /** Écart valorisé en FCFA entiers ; `null` sans coût unitaire ou sans écart. */
  ecartValorise: number | null;
  status: CoverageStatus;
}

/**
 * Statut selon la couverture CPRO / CPRA : < 80 % sous-distribution forte, 80–95 % sous-distribution,
 * 95–105 % conforme, 105–120 % sur-distribution, > 120 % sur-distribution forte. Les bornes basses de
 * chaque tranche sont incluses (95 % est conforme, 105 % aussi).
 */
export function consumableResult(
  input: { cpra: number; cpro: { value: number | null; status: CproStatus }; coutUnitaire?: number | null },
  bounds: CoverageBounds = DEFAULT_COVERAGE_BOUNDS,
): ConsumableResult {
  const { cpra: expected, cpro: delivered } = input;
  const base = { cpra: expected, cpro: delivered.value, ecartVolume: null, couverturePct: null, ecartValorise: null };
  if (delivered.status === "CONVERSION_MANQUANTE") return { ...base, status: "CONVERSION_MANQUANTE" };
  if (delivered.value === null) return { ...base, status: "CPRO_MANQUANT" };
  if (expected === 0) return { ...base, ecartVolume: delivered.value, status: "NA" };

  const ecartVolume = delivered.value - expected;
  const couverturePct = ratio(delivered.value * 100, expected);
  const c = couverturePct as number;
  const status: CoverageStatus = c < bounds.strongUnder ? "SOUS_FORTE" : c < bounds.under ? "SOUS" : c <= bounds.overFrom ? "CONFORME" : c <= bounds.strongOver ? "SUR" : "SUR_FORTE";
  const ecartValorise = input.coutUnitaire == null ? null : Math.round(ecartVolume * input.coutUnitaire);
  return { cpra: expected, cpro: delivered.value, ecartVolume, couverturePct, ecartValorise, status };
}
