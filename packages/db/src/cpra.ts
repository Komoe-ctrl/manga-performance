import { DEFAULT_COVERAGE_BOUNDS, type CoverageBounds } from "@manga/core/kpi/consumables";
import { type DeliveryRow, type ProductParam, type SkippedProduct, computeCpra } from "@manga/core/kpi/cpra-engine";
import type { NormalizedRow } from "@manga/core/collection";
import type { Prisma, PrismaClient } from "./generated/client";

/** Modèle de collecte dont les dépôts alimentent le moteur CPRA. */
export const CPRA_TEMPLATE_ID = "hotel_consommables_cpro";
const CPRO_SHEET = "Saisie_CPRO";
const POPULATION_SHEET = "Population";

const boundsKey = (clientId: string) => `cpra.bounds.${clientId}`;

/** Bornes de couverture d'un client (réglage `Setting`), les valeurs du client par défaut. */
export async function loadCoverageBounds(prisma: PrismaClient, clientId: string): Promise<CoverageBounds> {
  const row = await prisma.setting.findUnique({ where: { key: boundsKey(clientId) } });
  const v = row?.value as Partial<CoverageBounds> | null | undefined;
  if (!v || typeof v !== "object") return DEFAULT_COVERAGE_BOUNDS;
  const nums = [v.strongUnder, v.under, v.overFrom, v.strongOver];
  const ordered = nums.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0) && v.strongUnder! < v.under! && v.under! <= v.overFrom! && v.overFrom! < v.strongOver!;
  return ordered ? (v as CoverageBounds) : DEFAULT_COVERAGE_BOUNDS;
}

export async function saveCoverageBounds(prisma: PrismaClient, clientId: string, bounds: CoverageBounds): Promise<void> {
  await prisma.setting.upsert({ where: { key: boundsKey(clientId) }, create: { key: boundsKey(clientId), value: bounds as unknown as Prisma.InputJsonValue }, update: { value: bounds as unknown as Prisma.InputJsonValue } });
}

export async function loadProducts(prisma: PrismaClient, clientId: string): Promise<ProductParam[]> {
  const products = await prisma.clientProduct.findMany({
    where: { clientId },
    orderBy: { code: "asc" },
    include: { conversions: { orderBy: { deliveryUnit: "asc" } }, norms: { orderBy: { validFrom: "asc" } } },
  });
  return products.map((p) => ({
    id: p.id,
    code: p.code,
    label: p.label,
    referenceUnit: p.referenceUnit === "ml" ? "ml" : "unite",
    active: p.active,
    conversions: p.conversions.map((c) => ({ deliveryUnit: c.deliveryUnit, factor: c.factor === null ? null : Number(c.factor) })),
    norms: p.norms.map((n) => ({ entityId: n.entityId, validFrom: n.validFrom, normPerClient: Number(n.normPerClient), nonUserRate: Number(n.nonUserRate), unitCost: Number(n.unitCostFcfa) })),
  }));
}

/**
 * Listes de valeurs autorisées des feuilles du modèle hôtelier : les produits du catalogue et, pour chacun,
 * les unités de livraison déclarées. Un produit dont le facteur manque reste sélectionnable : le dépôt est
 * valide, c'est l'écart qui n'est pas calculé.
 */
export async function cpraTemplateOptions(prisma: PrismaClient, clientId: string): Promise<{ produits: string[]; unites: Record<string, string[]> }> {
  const products = (await loadProducts(prisma, clientId)).filter((p) => p.active);
  return { produits: products.map((p) => p.label), unites: Object.fromEntries(products.map((p) => [p.label, p.conversions.map((c) => c.deliveryUnit)])) };
}

export type ComputeCpraOutcome =
  | { computed: true; version: number; results: number; skipped: SkippedProduct[]; totalEcartValorise: number }
  | { computed: false; reason: "NOT_FOUND" | "NOT_CPRA_PLAN" | "NO_ACCEPTED_SUBMISSION" | "ALREADY_COMPUTED" | "NO_POPULATION" | "RACE" };

export interface ComputeCpraOptions {
  periodId: string;
  /** `null` pour le job automatique. */
  actorId: string | null;
  note?: string;
  /** Recalcul explicite : crée une nouvelle version même si ce dépôt a déjà été calculé. */
  force: boolean;
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * Calcule les écarts CPRO / CPRA d'une période à partir de son dépôt retenu (le plus récent `VALIDE` ou
 * `ACCEPTE_AVEC_RESERVE`). Chaque calcul est une version : un recalcul n'écrase rien. Le job automatique
 * (`force: false`) est idempotent : un dépôt déjà calculé n'est pas recalculé.
 */
export async function computeCpraForPeriod(prisma: PrismaClient, options: ComputeCpraOptions): Promise<ComputeCpraOutcome> {
  const period = await prisma.collectionPeriod.findUnique({
    where: { id: options.periodId },
    select: { id: true, periodStart: true, plan: { select: { templateId: true, entityId: true, entity: { select: { clientId: true } } } } },
  });
  if (!period) return { computed: false, reason: "NOT_FOUND" };
  if (period.plan.templateId !== CPRA_TEMPLATE_ID) return { computed: false, reason: "NOT_CPRA_PLAN" };

  const submission = await prisma.submission.findFirst({
    where: { periodId: period.id, status: { in: ["VALIDE", "ACCEPTE_AVEC_RESERVE"] } },
    orderBy: { version: "desc" },
    select: { id: true, rows: true },
  });
  if (!submission) return { computed: false, reason: "NO_ACCEPTED_SUBMISSION" };

  const latest = await prisma.cpraResult.findFirst({ where: { periodId: period.id }, orderBy: { version: "desc" }, select: { version: true, submissionId: true } });
  if (!options.force && latest?.submissionId === submission.id) return { computed: false, reason: "ALREADY_COMPUTED" };

  const rows = (submission.rows ?? {}) as Record<string, NormalizedRow[]>;
  const pop = rows[POPULATION_SHEET]?.[0];
  const pass = num(pop?.clientsPass);
  const longSejour = num(pop?.clientsLongSejour);
  if (pass === null || longSejour === null) return { computed: false, reason: "NO_POPULATION" };

  const deliveries: DeliveryRow[] = (rows[CPRO_SHEET] ?? []).flatMap((r) => {
    const quantite = num(r.quantite);
    return typeof r.produit === "string" && typeof r.uniteLivraison === "string" && quantite !== null ? [{ produit: r.produit, uniteLivraison: r.uniteLivraison, quantite }] : [];
  });

  const clientId = period.plan.entity.clientId;
  const [products, setting, bounds] = await Promise.all([
    loadProducts(prisma, clientId),
    prisma.entityCpraSetting.findFirst({ where: { entityId: period.plan.entityId, validFrom: { lte: period.periodStart } }, orderBy: { validFrom: "desc" }, select: { longStayFactor: true } }),
    loadCoverageBounds(prisma, clientId),
  ]);

  const computation = computeCpra({
    entityId: period.plan.entityId,
    periodStart: period.periodStart,
    products,
    longStayFactor: setting ? Number(setting.longStayFactor) : 1,
    population: { pass, longSejour },
    deliveries,
    bounds,
  });

  const version = (latest?.version ?? 0) + 1;
  try {
    await prisma.$transaction([
      prisma.cpraResult.createMany({
        data: computation.results.map((r) => ({
          periodId: period.id,
          submissionId: submission.id,
          productId: r.productId,
          cproRef: r.cpro,
          cpra: r.cpra,
          ecartVolume: r.ecartVolume,
          couverture: r.couverturePct,
          ecartValorise: r.ecartValorise,
          status: r.status,
          paramsSnapshot: r.snapshot as unknown as Prisma.InputJsonValue,
          note: options.note?.trim() || null,
          computedBy: options.actorId,
          version,
        })),
      }),
      prisma.auditLog.create({
        data: {
          actorId: options.actorId,
          action: "CPRA_COMPUTED",
          entity: "CollectionPeriod",
          entityId: period.id,
          diff: { version, submissionId: submission.id, results: computation.results.length, skipped: computation.skipped.map((s) => s.productCode), forced: options.force } as Prisma.InputJsonValue,
        },
      }),
    ]);
  } catch (error) {
    // Two computations raced for the same version: the unique key kept the first one.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") return { computed: false, reason: "RACE" };
    throw error;
  }
  return { computed: true, version, results: computation.results.length, skipped: computation.skipped, totalEcartValorise: computation.totalEcartValorise };
}
