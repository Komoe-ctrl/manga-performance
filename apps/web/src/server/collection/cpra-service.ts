import type { CoverageBounds } from "@manga/core/kpi/consumables";
import { CPRA_TEMPLATE_ID, computeCpraForPeriod, loadCoverageBounds, loadProducts, saveCoverageBounds } from "@manga/db/cpra";
import type { ProductParam } from "@manga/core/kpi/cpra-engine";
import type { PrismaClient } from "@manga/db";
import { DomainError } from "../domain-error";
import { recordAudit } from "../repositories/audit";

export interface CpraParamsView {
  products: (Omit<ProductParam, "norms"> & { norms: (Omit<ProductParam["norms"][number], "validFrom"> & { validFrom: string })[] })[];
  longStay: { entityId: string; entityName: string; validFrom: string; factor: number }[];
  bounds: CoverageBounds;
}

export interface CpraResultView {
  productId: string;
  productCode: string;
  productLabel: string;
  referenceUnit: string;
  cpra: number;
  cpro: number | null;
  ecartVolume: number | null;
  couverturePct: number | null;
  ecartValorise: number | null;
  status: string;
  version: number;
  note: string | null;
  computedAt: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function parseDay(value: string, what: string): Date {
  const date = DATE.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DomainError("VALIDATION", `${what} invalide (AAAA-MM-JJ).`);
  return date;
}
const finite = (value: number, what: string, { min = 0, max = 1e9, minExclusive = false } = {}) => {
  if (!Number.isFinite(value) || (minExclusive ? value <= min : value < min) || value > max) throw new DomainError("VALIDATION", `${what} invalide.`);
  return value;
};

/**
 * Paramètres CPRA des clients (catalogue, conversions, normes datées, facteur long séjour, bornes) et
 * recalcul explicite (avenant n°1, §11 bis). Administration seulement : appelé derrière `requireAdmin`.
 * Modifier un paramètre ne touche jamais un résultat existant ; seul un recalcul crée une nouvelle version.
 */
export function createCpraService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  const ownProduct = async (productId: string) => {
    const product = await prisma.clientProduct.findUnique({ where: { id: productId }, select: { id: true, clientId: true, code: true } });
    if (!product) throw new DomainError("NOT_FOUND", "Produit introuvable.");
    return product;
  };

  return {
    async getParams(clientId: string): Promise<CpraParamsView> {
      if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw new DomainError("NOT_FOUND", "Client introuvable.");
      const [products, settings, bounds] = await Promise.all([
        loadProducts(prisma, clientId),
        prisma.entityCpraSetting.findMany({ where: { entity: { clientId } }, orderBy: [{ entityId: "asc" }, { validFrom: "asc" }], include: { entity: { select: { name: true } } } }),
        loadCoverageBounds(prisma, clientId),
      ]);
      return {
        products: products.map((p) => ({ ...p, norms: p.norms.map((n) => ({ ...n, validFrom: n.validFrom.toISOString() })) })),
        longStay: settings.map((s) => ({ entityId: s.entityId, entityName: s.entity.name, validFrom: s.validFrom.toISOString(), factor: Number(s.longStayFactor) })),
        bounds,
      };
    },

    async saveProduct(input: { clientId: string; code: string; label: string; referenceUnit: "unite" | "ml"; active?: boolean }, actorId: string): Promise<{ id: string }> {
      const code = input.code.trim().toUpperCase();
      const label = input.label.trim();
      if (!/^[A-Z0-9_]{1,20}$/.test(code)) throw new DomainError("VALIDATION", "Code produit invalide (lettres, chiffres, _ ; 20 caractères au plus).");
      if (label.length < 2 || label.length > 80) throw new DomainError("VALIDATION", "Libellé invalide (2 à 80 caractères).");
      if (input.referenceUnit !== "unite" && input.referenceUnit !== "ml") throw new DomainError("VALIDATION", "Unité de référence inconnue.");
      if (!(await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } }))) throw new DomainError("NOT_FOUND", "Client introuvable.");
      const clash = await prisma.clientProduct.findFirst({ where: { clientId: input.clientId, label, NOT: { code } }, select: { id: true } });
      if (clash) throw new DomainError("DUPLICATE", "Un autre produit porte déjà ce libellé.");
      const data = { label, referenceUnit: input.referenceUnit, ...(input.active === undefined ? {} : { active: input.active }) };
      const saved = await prisma.clientProduct.upsert({ where: { clientId_code: { clientId: input.clientId, code } }, create: { clientId: input.clientId, code, ...data }, update: data, select: { id: true } });
      await recordAudit(prisma, { actorId, action: "cpra.product", entity: "ClientProduct", entityId: saved.id, diff: { code, label, referenceUnit: input.referenceUnit, active: input.active ?? null } });
      return saved;
    },

    /** Déclare une unité de livraison ; `factor: null` = facteur à renseigner (« conversion manquante »). */
    async setConversion(input: { productId: string; deliveryUnit: string; factor: number | null }, actorId: string): Promise<void> {
      const product = await ownProduct(input.productId);
      const deliveryUnit = input.deliveryUnit.trim();
      if (deliveryUnit.length < 1 || deliveryUnit.length > 40) throw new DomainError("VALIDATION", "Unité de livraison invalide.");
      const factor = input.factor === null ? null : finite(input.factor, "Facteur", { min: 0, max: 1e7, minExclusive: true });
      await prisma.productConversion.upsert({
        where: { productId_deliveryUnit: { productId: product.id, deliveryUnit } },
        create: { productId: product.id, deliveryUnit, factor },
        update: { factor },
      });
      await recordAudit(prisma, { actorId, action: "cpra.conversion", entity: "ClientProduct", entityId: product.id, diff: { deliveryUnit, factor } });
    },

    /** Ajoute une norme datée. Les normes ne se modifient pas : une nouvelle date d'effet garde l'historique. */
    async addNorm(input: { productId: string; entityId: string | null; validFrom: string; normPerClient: number; nonUserRate: number; unitCostFcfa: number }, actorId: string): Promise<{ id: string }> {
      const product = await ownProduct(input.productId);
      const validFrom = parseDay(input.validFrom, "Date d'effet");
      if (input.entityId !== null) {
        const entity = await prisma.entity.findUnique({ where: { id: input.entityId }, select: { clientId: true } });
        if (!entity || entity.clientId !== product.clientId) throw new DomainError("NOT_FOUND", "Entité introuvable pour ce client.");
      }
      const dup = await prisma.cpraNorm.findFirst({ where: { productId: product.id, entityId: input.entityId, validFrom }, select: { id: true } });
      if (dup) throw new DomainError("DUPLICATE", "Une norme existe déjà à cette date d'effet pour ce périmètre.");
      const created = await prisma.cpraNorm.create({
        data: {
          productId: product.id,
          entityId: input.entityId,
          validFrom,
          normPerClient: finite(input.normPerClient, "Norme", { max: 1e7 }),
          nonUserRate: finite(input.nonUserRate, "Taux de non-utilisateurs", { max: 1 }),
          unitCostFcfa: finite(input.unitCostFcfa, "Coût unitaire", { max: 1e7 }),
        },
        select: { id: true },
      });
      await recordAudit(prisma, { actorId, action: "cpra.norm", entity: "ClientProduct", entityId: product.id, diff: { ...input } });
      return created;
    },

    async setLongStayFactor(input: { entityId: string; validFrom: string; factor: number }, actorId: string): Promise<void> {
      const validFrom = parseDay(input.validFrom, "Date d'effet");
      const factor = finite(input.factor, "Facteur long séjour", { min: 1, max: 10 });
      const entity = await prisma.entity.findUnique({ where: { id: input.entityId }, select: { id: true, sector: true } });
      if (!entity) throw new DomainError("NOT_FOUND", "Entité introuvable.");
      if (entity.sector !== "HOTELLERIE") throw new DomainError("VALIDATION", "Le facteur long séjour ne concerne que les hôtels.");
      await prisma.entityCpraSetting.upsert({ where: { entityId_validFrom: { entityId: entity.id, validFrom } }, create: { entityId: entity.id, validFrom, longStayFactor: factor }, update: { longStayFactor: factor } });
      await recordAudit(prisma, { actorId, action: "cpra.long-stay", entity: "Entity", entityId: entity.id, diff: { validFrom: input.validFrom, factor } });
    },

    async saveBounds(clientId: string, bounds: CoverageBounds, actorId: string): Promise<void> {
      const { strongUnder: a, under: b, overFrom: c, strongOver: d } = bounds;
      if (![a, b, c, d].every((n) => Number.isFinite(n) && n > 0 && n <= 1000) || !(a < b && b <= c && c < d)) {
        throw new DomainError("VALIDATION", "Bornes incohérentes : elles doivent être strictement croissantes (95 et 105 peuvent coïncider).");
      }
      if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw new DomainError("NOT_FOUND", "Client introuvable.");
      await saveCoverageBounds(prisma, clientId, bounds);
      await recordAudit(prisma, { actorId, action: "cpra.bounds", entity: "Client", entityId: clientId, diff: { ...bounds } });
    },

    /** Recalcul explicite : nouvelle version, l'ancienne reste consultable. */
    async recompute(periodId: string, note: string, actorId: string): Promise<{ version: number; skipped: string[] }> {
      const outcome = await computeCpraForPeriod(prisma, { periodId, actorId, note: note.slice(0, 200), force: true });
      if (outcome.computed) return { version: outcome.version, skipped: outcome.skipped.map((s) => s.productCode) };
      const messages = {
        NOT_FOUND: ["NOT_FOUND", "Période introuvable."],
        NOT_CPRA_PLAN: ["VALIDATION", "Cette période n'appartient pas au pilote hôtellerie (consommables)."],
        NO_ACCEPTED_SUBMISSION: ["CONFLICT", "Aucun dépôt validé ou accepté avec réserve pour cette période."],
        NO_POPULATION: ["CONFLICT", "Le dépôt ne contient pas la population accueillie."],
        ALREADY_COMPUTED: ["CONFLICT", "Déjà calculé."],
        RACE: ["CONFLICT", "Un calcul est déjà en cours pour cette période, réessayez."],
      } as const;
      const [code, message] = messages[outcome.reason];
      throw new DomainError(code, message);
    },

    /** Résultats d'une période, à une version donnée (la dernière par défaut), et la liste des versions. */
    async results(periodId: string, version?: number): Promise<{ versions: { version: number; computedAt: string; note: string | null }[]; version: number | null; results: CpraResultView[] }> {
      const period = await prisma.collectionPeriod.findUnique({ where: { id: periodId }, select: { plan: { select: { templateId: true } } } });
      if (!period) throw new DomainError("NOT_FOUND", "Période introuvable.");
      if (period.plan.templateId !== CPRA_TEMPLATE_ID) return { versions: [], version: null, results: [] };
      const rows = await prisma.cpraResult.findMany({ where: { periodId }, orderBy: [{ version: "desc" }, { product: { code: "asc" } }], include: { product: true } });
      const versions = [...new Map(rows.map((r) => [r.version, { version: r.version, computedAt: r.computedAt.toISOString(), note: r.note }])).values()];
      const chosen = version ?? versions[0]?.version ?? null;
      if (version !== undefined && !versions.some((v) => v.version === version)) throw new DomainError("NOT_FOUND", "Version introuvable.");
      return {
        versions,
        version: chosen,
        results: rows
          .filter((r) => r.version === chosen)
          .map((r) => ({
            productId: r.productId,
            productCode: r.product.code,
            productLabel: r.product.label,
            referenceUnit: r.product.referenceUnit,
            cpra: Number(r.cpra),
            cpro: r.cproRef === null ? null : Number(r.cproRef),
            ecartVolume: r.ecartVolume === null ? null : Number(r.ecartVolume),
            couverturePct: r.couverture === null ? null : Number(r.couverture),
            ecartValorise: r.ecartValorise,
            status: r.status,
            version: r.version,
            note: r.note,
            computedAt: r.computedAt.toISOString(),
          })),
      };
    },
  };
}

export type CpraService = ReturnType<typeof createCpraService>;
