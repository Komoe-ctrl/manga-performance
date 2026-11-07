import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
} from "@manga/core";
import type { Prisma, PrismaClient } from "@manga/db";
import { MAX_RESULTS_PER_JOB, createScrapeJobSchema, scrapeResultItemSchema } from "@manga/validation";
import { z } from "zod";
import type { ScrapeJob, ScrapeResult } from "@/lib/types";
import type { CrmService } from "../crm/crm-service";
import { CrmError } from "../crm/errors";
import { DomainError } from "../domain-error";
import { recordAudit } from "../repositories/audit";

export type ScrapeErrorCode = "NOT_FOUND" | "INVALID" | "CONFLICT";

export class ScrapeError extends DomainError {
  constructor(code: ScrapeErrorCode, message: string) {
    super(code, message);
    this.name = "ScrapeError";
  }
}

export interface ScrapeDeps {
  prisma: PrismaClient;
  crm: Pick<CrmService, "findDuplicate" | "createProspect">;
  now?: () => Date;
}

/** A job that has been RUNNING this long is assumed dead (the scraper crashed). */
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

const SOURCE_TO_DB = { annuaire: "ANNUAIRE", appels_offres: "APPELS_OFFRES", site_web: "SITE_WEB" } as const;
const SOURCE_TO_FRONT = { ANNUAIRE: "annuaire", APPELS_OFFRES: "appels_offres", SITE_WEB: "site_web" } as const;
const STATUS_TO_FRONT = { QUEUED: "en_cours", RUNNING: "en_cours", DONE: "termine", FAILED: "echec" } as const;

export interface ClaimedJob {
  id: string;
  source: string;
  filters: Record<string, unknown>;
}

export interface BatchOutcome {
  accepted: number;
  duplicates: number;
  invalid: number;
  /** Set when the per-job ceiling was reached: the scraper should stop. */
  limitReached: boolean;
}

/**
 * Scraping jobs (spec, 6.10): the admin creates a job, the Python service claims it, pushes
 * results in batches and closes it. Results are deduplicated on arrival, and only an
 * explicit admin action turns them into CRM prospects.
 */
export function createScrapeService({ prisma, crm, now = () => new Date() }: ScrapeDeps) {
  const toFrontJob = (row: Prisma.ScrapeJobGetPayload<object>): ScrapeJob => ({
    id: row.id,
    source: SOURCE_TO_FRONT[row.source as keyof typeof SOURCE_TO_FRONT] ?? "site_web",
    filters: (row.filters ?? {}) as ScrapeJob["filters"],
    status: STATUS_TO_FRONT[row.status as keyof typeof STATUS_TO_FRONT] ?? "echec",
    startedAt: (row.startedAt ?? row.createdAt).toISOString(),
    resultsCount: row.resultsCount,
  });

  const toFrontResult = (row: Prisma.ScrapeResultGetPayload<object>): ScrapeResult => ({
    id: row.id,
    jobId: row.jobId,
    companyName: row.companyName,
    sector: row.sector ?? "Non précisé",
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    importedToCrm: row.importedProspectId !== null,
    duplicateOf: row.duplicateOfProspectId ?? undefined,
  });

  return {
    // ---- back-office ----------------------------------------------------------------

    async createJob(input: unknown, actorId: string): Promise<ScrapeJob> {
      const parsed = createScrapeJobSchema.safeParse(input);
      if (!parsed.success) throw new ScrapeError("INVALID", "Paramètres de collecte invalides.");
      const row = await prisma.scrapeJob.create({
        data: { source: SOURCE_TO_DB[parsed.data.source], filters: parsed.data.filters as Prisma.InputJsonValue, status: "QUEUED", createdBy: actorId },
      });
      await recordAudit(prisma, { actorId, action: "scrape.job_created", entity: "ScrapeJob", entityId: row.id, diff: { source: row.source } });
      return toFrontJob(row);
    },

    async listJobs(): Promise<ScrapeJob[]> {
      return (await prisma.scrapeJob.findMany({ orderBy: { createdAt: "desc" }, take: 100 })).map(toFrontJob);
    },

    async getJob(id: string): Promise<ScrapeJob | null> {
      const row = await prisma.scrapeJob.findUnique({ where: { id } });
      return row ? toFrontJob(row) : null;
    },

    async listResults(jobId: string): Promise<ScrapeResult[]> {
      return (await prisma.scrapeResult.findMany({ where: { jobId }, orderBy: { collectedAt: "asc" } })).map(toFrontResult);
    },

    /**
     * Turns the selected results into CRM prospects of source SCRAPER. Duplicates and results
     * already imported are skipped. No email sequence is ever started: that is a separate,
     * manual decision, and compliance is for the client to validate (spec, 6.10).
     */
    async importResults(ids: string[], actorId: string): Promise<{ imported: number; skipped: number }> {
      let imported = 0;
      let skipped = 0;
      for (const id of [...new Set(ids)].slice(0, 1000)) {
        const result = await prisma.scrapeResult.findUnique({ where: { id } });
        if (!result || result.importedProspectId || result.duplicateOfProspectId) {
          skipped++;
          continue;
        }
        try {
          const prospect = await crm.createProspect(
            {
              companyName: result.companyName,
              email: result.email ?? undefined,
              phone: result.phone ?? undefined,
              sector: result.sector ?? "Non précisé",
              city: result.city ?? undefined,
              source: "scraper",
              ownerNote: `Collecté depuis ${result.sourceUrl}`,
            },
            actorId,
          );
          await prisma.scrapeResult.update({ where: { id }, data: { importedProspectId: prospect.id } });
          imported++;
        } catch (error) {
          if (error instanceof CrmError && error.code === "DUPLICATE") {
            // The prospect appeared since the collection: remember it, do not import.
            await prisma.scrapeResult.update({ where: { id }, data: { duplicateOfProspectId: error.details?.existingId ?? null } });
            skipped++;
            continue;
          }
          throw error;
        }
      }
      await recordAudit(prisma, { actorId, action: "scrape.imported", entity: "ScrapeJob", entityId: "selection", diff: { imported, skipped } });
      return { imported, skipped };
    },

    // ---- internal API (the Python scraper) --------------------------------------------

    /** Claims the oldest queued job, atomically (`SKIP LOCKED`: two scrapers never get the same one). */
    async claimNext(): Promise<ClaimedJob | null> {
      const at = now();
      // A scraper that died mid-job must not block its slot forever.
      await prisma.scrapeJob.updateMany({
        where: { status: "RUNNING", startedAt: { lt: new Date(at.getTime() - STALE_RUNNING_MS) } },
        data: { status: "FAILED", finishedAt: at, error: "Délai dépassé : le service de collecte ne répond plus." },
      });
      const rows = await prisma.$queryRaw<{ id: string; source: string; filters: Record<string, unknown> }[]>`
        UPDATE "ScrapeJob" SET "status" = 'RUNNING', "startedAt" = ${at}
        WHERE "id" = (
          SELECT "id" FROM "ScrapeJob" WHERE "status" = 'QUEUED'
          ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "source", "filters"`;
      return rows[0] ?? null;
    },

    /**
     * Accepts a batch. Each item is validated on its own (one bad row never loses the batch)
     * and deduplicated: against the other results of the same job (email, phone, similar
     * name) and against the existing CRM (same checks). CRM duplicates are kept but flagged.
     */
    async acceptResults(jobId: string, rawItems: unknown[]): Promise<BatchOutcome> {
      const job = await prisma.scrapeJob.findUnique({ where: { id: jobId } });
      if (!job) throw new ScrapeError("NOT_FOUND", "Job introuvable.");
      if (job.status !== "RUNNING") throw new ScrapeError("CONFLICT", "Ce job n'accepte plus de résultats.");

      const outcome: BatchOutcome = { accepted: 0, duplicates: 0, invalid: 0, limitReached: false };
      const room = Math.max(0, MAX_RESULTS_PER_JOB - job.resultsCount);
      if (rawItems.length > room) outcome.limitReached = true;

      for (const raw of rawItems.slice(0, room)) {
        const parsed = scrapeResultItemSchema.safeParse(raw);
        if (!parsed.success) {
          outcome.invalid++;
          continue;
        }
        const item = parsed.data;
        const companyNameNorm = normalizeCompanyName(item.companyName);
        if (!companyNameNorm) {
          outcome.invalid++;
          continue;
        }
        // Unusable contact details are dropped, not trusted.
        const email = item.email && z.email().safeParse(normalizeEmail(item.email)).success ? normalizeEmail(item.email) : undefined;
        const phone = item.phone ? (normalizePhone(item.phone) ?? undefined) : undefined;

        if (await this.isDuplicateInJob(jobId, { email, phone, companyNameNorm })) {
          outcome.duplicates++;
          continue;
        }
        const known = await crm.findDuplicate({ email, phone, companyNameNorm });
        await prisma.scrapeResult.create({
          data: {
            jobId,
            companyName: item.companyName,
            companyNameNorm,
            sector: item.sector,
            city: item.city,
            address: item.address,
            phone,
            email,
            sourceUrl: item.sourceUrl,
            collectedAt: new Date(item.collectedAt),
            duplicateOfProspectId: known?.id ?? null,
          },
        });
        outcome.accepted++;
      }

      if (outcome.accepted > 0) {
        await prisma.scrapeJob.update({ where: { id: jobId }, data: { resultsCount: { increment: outcome.accepted } } });
      }
      return outcome;
    },

    async isDuplicateInJob(jobId: string, keys: { email?: string; phone?: string; companyNameNorm: string }): Promise<boolean> {
      const byContact = [...(keys.email ? [{ email: keys.email }] : []), ...(keys.phone ? [{ phone: keys.phone }] : [])];
      if (byContact.length > 0 && (await prisma.scrapeResult.findFirst({ where: { jobId, OR: byContact }, select: { id: true } }))) return true;
      const similar = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ScrapeResult"
        WHERE "jobId" = ${jobId} AND similarity("companyNameNorm", ${keys.companyNameNorm}) > ${DUPLICATE_SIMILARITY_THRESHOLD}::real
        LIMIT 1`;
      return similar.length > 0;
    },

    /** Closes a job. Repeating the same closing is harmless; changing an outcome is refused. */
    async finish(jobId: string, input: { status: "DONE" | "FAILED"; error?: string }): Promise<ScrapeJob> {
      const job = await prisma.scrapeJob.findUnique({ where: { id: jobId } });
      if (!job) throw new ScrapeError("NOT_FOUND", "Job introuvable.");
      if (job.status === input.status) return toFrontJob(job);
      if (job.status !== "RUNNING") throw new ScrapeError("CONFLICT", "Ce job est déjà clôturé.");

      const row = await prisma.scrapeJob.update({
        where: { id: jobId },
        data: {
          status: input.status,
          finishedAt: now(),
          // The count is the server's own, never the scraper's claim.
          resultsCount: await prisma.scrapeResult.count({ where: { jobId } }),
          error: input.status === "FAILED" ? (input.error ?? "Échec de la collecte.").slice(0, 500) : null,
        },
      });
      return toFrontJob(row);
    },
  };
}

export type ScrapeService = ReturnType<typeof createScrapeService>;
