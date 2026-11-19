import { buildConsolidatedWorkbook, createZip, getTemplate, periodKey, type CollectionSector, type ExportDeposit, type MissingEntry, type NormalizedRow, type TemplateDef } from "@manga/core/collection";
import type { PrismaClient } from "@manga/db";
import { DomainError } from "../domain-error";
import { recordAudit } from "../repositories/audit";
import type { ObjectStorage } from "../storage/object-storage";
import { entityScope, type CollectionActor } from "./scope";

/** Au plus 24 mois par export : au-delà, l'export est un usage de Power BI, pas d'un fichier. */
export const MAX_EXPORT_MONTHS = 24;
export const MAX_ZIP_FILES = 100;
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;

const ACCEPTED = ["VALIDE", "ACCEPTE_AVEC_RESERVE"] as const;
const SECTORS: readonly CollectionSector[] = ["BTP", "HOTELLERIE", "RESTAURATION", "COMMERCE", "TECH_FINTECH"];

export interface ExportFilters {
  templateId: string;
  /** Mois de début et de fin, inclus (`AAAA-MM`). */
  from: string;
  to: string;
  clientId?: string;
  sector?: string;
  entityId?: string;
}

interface Resolved {
  template: TemplateDef;
  deposits: (ExportDeposit & { storageKey: string; originalName: string; sizeBytes: number })[];
  missing: MissingEntry[];
  rangeLabel: string;
}

function monthBounds(from: string, to: string): { start: Date; end: Date } {
  const pattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const a = pattern.exec(from);
  const b = pattern.exec(to);
  if (!a || !b) throw new DomainError("VALIDATION", "Les mois doivent être au format AAAA-MM.");
  const start = new Date(Date.UTC(Number(a[1]), Number(a[2]) - 1, 1));
  const end = new Date(Date.UTC(Number(b[1]), Number(b[2]), 0));
  if (end < start) throw new DomainError("VALIDATION", "Le mois de fin précède le mois de début.");
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
  if (months > MAX_EXPORT_MONTHS) throw new DomainError("VALIDATION", `La plage est limitée à ${MAX_EXPORT_MONTHS} mois.`);
  return { start, end };
}

export function createExportService(deps: { prisma: PrismaClient; storage: ObjectStorage; now?: () => Date }) {
  const { prisma, storage } = deps;
  const now = deps.now ?? (() => new Date());

  /** Tout passe par `entityScope`, puis par les filtres : un filtre ne peut qu'ajouter des restrictions. */
  async function resolve(actor: CollectionActor, filters: ExportFilters): Promise<Resolved> {
    if (actor.role === "CLIENT_CONTRIBUTEUR") throw new DomainError("FORBIDDEN", "L'export consolidé est réservé à la direction, à l'analyste et à l'administrateur.");
    const template = getTemplate(filters.templateId);
    if (!template) throw new DomainError("VALIDATION", "Modèle de collecte inconnu.");
    if (filters.sector && !SECTORS.includes(filters.sector as CollectionSector)) throw new DomainError("VALIDATION", "Secteur inconnu.");
    const { start, end } = monthBounds(filters.from, filters.to);

    const scope = await entityScope(prisma, actor);
    const periods = await prisma.collectionPeriod.findMany({
      where: {
        periodStart: { gte: start, lte: end },
        plan: {
          templateId: template.id,
          entityId: filters.entityId ? { in: scope.filter((id) => id === filters.entityId) } : { in: scope },
          entity: { ...(filters.clientId ? { clientId: filters.clientId } : {}), ...(filters.sector ? { sector: filters.sector as CollectionSector } : {}) },
        },
      },
      select: {
        periodStart: true,
        periodEnd: true,
        dueAt: true,
        status: true,
        plan: { select: { entity: { select: { name: true, client: { select: { legalName: true } } } } } },
        submissions: {
          where: { status: { in: [...ACCEPTED] } },
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, status: true, rows: true, storageKey: true, originalName: true, sizeBytes: true },
        },
      },
    });

    const deposits: Resolved["deposits"] = [];
    const missing: MissingEntry[] = [];
    for (const period of periods) {
      const entity = period.plan.entity.name;
      const client = period.plan.entity.client.legalName;
      const accepted = period.submissions[0];
      if (accepted && (accepted.status === "VALIDE" || accepted.status === "ACCEPTE_AVEC_RESERVE")) {
        deposits.push({
          client,
          entity,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          version: accepted.version,
          status: accepted.status,
          rows: (accepted.rows as Record<string, NormalizedRow[]> | null) ?? {},
          storageKey: accepted.storageKey,
          originalName: accepted.originalName,
          sizeBytes: accepted.sizeBytes,
        });
      } else {
        missing.push({ client, entity, periodStart: period.periodStart, periodEnd: period.periodEnd, status: period.status, dueAt: period.dueAt });
      }
    }
    return { template, deposits, missing, rangeLabel: filters.from === filters.to ? filters.from : `${filters.from}_${filters.to}` };
  }

  return {
    /** Fichier Excel consolidé (avenant §8) : lignes des dépôts acceptés + feuille `Suivi`. */
    async exportWorkbook(actor: CollectionActor, filters: ExportFilters): Promise<{ buffer: Buffer; filename: string }> {
      const data = await resolve(actor, filters);
      const buffer = await buildConsolidatedWorkbook({ template: data.template, deposits: data.deposits, missing: data.missing, generatedAt: now() });
      await recordAudit(prisma, { actorId: actor.userId, action: "collection.export", entity: "CollectionExport", entityId: data.template.id, diff: { kind: "xlsx", ...filters, deposits: data.deposits.length, missing: data.missing.length } });
      return { buffer, filename: `consolidation_${data.template.id}_${data.rangeLabel}.xlsx` };
    },

    /** ZIP des fichiers originaux des dépôts acceptés, rangés par client et par entité. */
    async exportOriginals(actor: CollectionActor, filters: ExportFilters): Promise<{ buffer: Buffer; filename: string; files: number }> {
      const data = await resolve(actor, filters);
      if (data.deposits.length > MAX_ZIP_FILES || data.deposits.reduce((sum, d) => sum + d.sizeBytes, 0) > MAX_ZIP_BYTES) {
        throw new DomainError("TOO_LARGE", `L'archive dépasserait ${MAX_ZIP_FILES} fichiers ou ${MAX_ZIP_BYTES / 1024 / 1024} Mo : affinez les filtres (client, entité, période).`);
      }
      const entries = [];
      for (const d of data.deposits) {
        entries.push({
          name: `${d.client}/${d.entity}/${periodKey(d.periodStart, d.periodEnd)}_v${d.version}_${d.originalName}`,
          data: await storage.read(d.storageKey),
        });
      }
      await recordAudit(prisma, { actorId: actor.userId, action: "collection.export", entity: "CollectionExport", entityId: data.template.id, diff: { kind: "zip", ...filters, files: entries.length } });
      return { buffer: createZip(entries), filename: `originaux_${data.template.id}_${data.rangeLabel}.zip`, files: entries.length };
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
