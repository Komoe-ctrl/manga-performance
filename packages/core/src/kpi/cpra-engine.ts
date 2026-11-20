import { type CoverageBounds, type CoverageStatus, DEFAULT_COVERAGE_BOUNDS, consumableResult, cpra, cpro } from "./consumables";

/**
 * Moteur CPRA d'un hôtel pour une période (avenant n°1, §11 bis). Fonction pure : les paramètres sont
 * fournis déjà chargés, le résultat embarque l'instantané des paramètres utilisés (calcul reproductible).
 */

export interface NormParam {
  /** `null` = norme par défaut du client. */
  entityId: string | null;
  validFrom: Date;
  normPerClient: number;
  nonUserRate: number;
  unitCost: number;
}

export interface ProductParam {
  id: string;
  code: string;
  label: string;
  referenceUnit: "unite" | "ml";
  active: boolean;
  /** Unité de livraison -> facteur ; `null` = unité déclarée sans facteur (conversion manquante). */
  conversions: { deliveryUnit: string; factor: number | null }[];
  norms: NormParam[];
}

export interface DeliveryRow {
  produit: string;
  uniteLivraison: string;
  quantite: number;
}

export interface CpraComputeInput {
  entityId: string;
  periodStart: Date;
  products: readonly ProductParam[];
  /** Facteur long séjour déjà résolu (1 par défaut). */
  longStayFactor: number;
  population: { pass: number; longSejour: number };
  deliveries: readonly DeliveryRow[];
  bounds?: CoverageBounds;
}

export interface CpraSnapshot {
  norm: { validFrom: string; scope: "ENTITY" | "CLIENT"; normPerClient: number; nonUserRate: number; unitCost: number };
  longStayFactor: number;
  population: { pass: number; longSejour: number };
  lines: { deliveryUnit: string; quantite: number; factor: number | null }[];
  bounds: CoverageBounds;
}

export interface ProductCpraResult {
  productId: string;
  productCode: string;
  productLabel: string;
  referenceUnit: "unite" | "ml";
  cpra: number;
  cpro: number | null;
  ecartVolume: number | null;
  couverturePct: number | null;
  ecartValorise: number | null;
  status: CoverageStatus;
  snapshot: CpraSnapshot;
}

export interface SkippedProduct {
  productId: string;
  productCode: string;
  reason: "NORME_MANQUANTE";
}

export interface CpraComputation {
  results: ProductCpraResult[];
  skipped: SkippedProduct[];
  /** Somme des écarts valorisés calculés, en FCFA entiers. */
  totalEcartValorise: number;
}

const norm = (value: string) => value.trim().toLowerCase();

/**
 * Dernière norme dont la date d'effet est antérieure ou égale au début de la période. Une norme
 * applicable propre à l'entité l'emporte sur celle du client, même si cette dernière est plus récente.
 */
export function resolveNorm(norms: readonly NormParam[], entityId: string, periodStart: Date): { norm: NormParam; scope: "ENTITY" | "CLIENT" } | null {
  const latest = (list: NormParam[]) => list.reduce<NormParam | null>((best, n) => (best === null || n.validFrom > best.validFrom ? n : best), null);
  const applicable = norms.filter((n) => n.validFrom.getTime() <= periodStart.getTime());
  const own = latest(applicable.filter((n) => n.entityId === entityId));
  if (own) return { norm: own, scope: "ENTITY" };
  const shared = latest(applicable.filter((n) => n.entityId === null));
  return shared ? { norm: shared, scope: "CLIENT" } : null;
}

export function computeCpra(input: CpraComputeInput): CpraComputation {
  const bounds = input.bounds ?? DEFAULT_COVERAGE_BOUNDS;
  const results: ProductCpraResult[] = [];
  const skipped: SkippedProduct[] = [];

  for (const product of input.products) {
    if (!product.active) continue;
    const resolved = resolveNorm(product.norms, input.entityId, input.periodStart);
    if (!resolved) {
      skipped.push({ productId: product.id, productCode: product.code, reason: "NORME_MANQUANTE" });
      continue;
    }
    const { norm: n, scope } = resolved;

    const lines = input.deliveries
      .filter((d) => norm(d.produit) === norm(product.label) || norm(d.produit) === norm(product.code))
      .map((d) => ({
        deliveryUnit: d.uniteLivraison,
        quantite: d.quantite,
        factor: product.conversions.find((c) => norm(c.deliveryUnit) === norm(d.uniteLivraison))?.factor ?? null,
      }));

    const expected = cpra({
      normPerClient: n.normPerClient,
      nonUserRate: n.nonUserRate,
      clientsPass: input.population.pass,
      clientsLongSejour: input.population.longSejour,
      longStayFactor: input.longStayFactor,
    });
    const result = consumableResult({ cpra: expected, cpro: cpro(lines.map((l) => ({ quantite: l.quantite, facteur: l.factor }))), coutUnitaire: n.unitCost }, bounds);

    results.push({
      productId: product.id,
      productCode: product.code,
      productLabel: product.label,
      referenceUnit: product.referenceUnit,
      cpra: result.cpra,
      cpro: result.cpro,
      ecartVolume: result.ecartVolume,
      couverturePct: result.couverturePct,
      ecartValorise: result.ecartValorise,
      status: result.status,
      snapshot: {
        norm: { validFrom: n.validFrom.toISOString(), scope, normPerClient: n.normPerClient, nonUserRate: n.nonUserRate, unitCost: n.unitCost },
        longStayFactor: input.longStayFactor,
        population: input.population,
        lines,
        bounds,
      },
    });
  }

  return { results, skipped, totalEcartValorise: results.reduce((sum, r) => sum + (r.ecartValorise ?? 0), 0) };
}
