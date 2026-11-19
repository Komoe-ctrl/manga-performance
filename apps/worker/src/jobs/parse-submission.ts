import { checkWorkbook, getTemplate, type NormalizedRow, type PeriodContext } from "@manga/core/collection";
import type { Prisma } from "@manga/db";
import type { WorkerDeps } from "../deps";

/** Lecture d'un objet du bucket privé (le worker ne présigne rien : il lit directement). */
export interface ObjectReader {
  read(key: string): Promise<Uint8Array>;
}

export type ParseDeps = WorkerDeps & { storage: ObjectReader };

export interface ParseJob {
  submissionId: string;
  /** Vrai à la dernière tentative : une panne technique est alors définitive. */
  finalAttempt?: boolean;
}

const rowCount = (rows: Record<string, NormalizedRow[]>) => Object.values(rows).reduce((sum, list) => sum + list.length, 0);

/**
 * Job `collection.parse-submission` (avenant n°1, §7) : lit le dépôt, le contrôle avec le moteur du
 * modèle, enregistre le rapport et les lignes normalisées, puis passe le dépôt et la période en
 * `VALIDE` ou `REJETE`. Idempotent : un dépôt déjà traité n'est pas retraité.
 *
 * Un fichier refusé (macro, bombe, mauvaise période…) est un REJET normal, pas une panne. Une vraie
 * panne (stockage injoignable) relance le job ; à la dernière tentative le dépôt passe en
 * `ERREUR_TECHNIQUE` et la période redevient ouvrable.
 */
export async function handleParseSubmission(job: ParseJob, deps: ParseDeps): Promise<void> {
  const { prisma, storage, env, logger } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const submission = await prisma.submission.findUnique({
    where: { id: job.submissionId },
    select: {
      id: true,
      status: true,
      storageKey: true,
      templateId: true,
      periodId: true,
      period: { select: { id: true, planId: true, periodStart: true, periodEnd: true, dueAt: true, plan: { select: { entityId: true } } } },
    },
  });
  if (!submission || submission.status !== "EN_CONTROLE") return;

  const technicalFailure = async (reason: string) => {
    await prisma.$transaction([
      prisma.submission.update({ where: { id: submission.id }, data: { status: "ERREUR_TECHNIQUE", report: { errors: [], warnings: [], truncated: false, technical: reason } } }),
      prisma.collectionPeriod.updateMany({ where: { id: submission.periodId, status: "EN_CONTROLE" }, data: { status: now > submission.period.dueAt ? "EN_RETARD" : "ATTENDU" } }),
    ]);
  };

  const template = getTemplate(submission.templateId);
  if (!template) {
    logger.error({ submissionId: submission.id }, "unknown collection template");
    await technicalFailure("TEMPLATE_UNKNOWN");
    return;
  }

  try {
    const buffer = await storage.read(submission.storageKey);

    // Previous month of the same plan, for the coherence warnings (accepted deposits only).
    const previous = await prisma.submission.findFirst({
      where: {
        status: { in: ["VALIDE", "ACCEPTE_AVEC_RESERVE"] },
        period: { planId: submission.period.planId, periodStart: { lt: submission.period.periodStart } },
      },
      orderBy: { period: { periodStart: "desc" } },
      select: { rows: true },
    });
    const ctx: PeriodContext = {
      periodStart: submission.period.periodStart,
      periodEnd: submission.period.periodEnd,
      previous: (previous?.rows as Record<string, NormalizedRow[]> | null) ?? undefined,
    };

    const result = await checkWorkbook({
      buffer,
      template,
      expected: { entityId: submission.period.plan.entityId, periodId: submission.periodId },
      ctx,
      secret: env.TRACKING_HMAC_SECRET,
    });

    const status = result.ok ? "VALIDE" : "REJETE";
    await prisma.$transaction([
      prisma.submission.update({
        where: { id: submission.id },
        data: {
          status,
          report: { errors: result.errors, warnings: result.warnings, truncated: result.truncated } as unknown as Prisma.InputJsonValue,
          rows: result.rows as unknown as Prisma.InputJsonValue,
          rowCount: result.ok ? rowCount(result.rows) : null,
        },
      }),
      // Only a period still waiting for this check moves: a forced or reset period is left alone.
      prisma.collectionPeriod.updateMany({ where: { id: submission.periodId, status: "EN_CONTROLE" }, data: { status } }),
    ]);
    logger.info({ submissionId: submission.id, status, errors: result.errors.length, warnings: result.warnings.length }, "submission checked");
  } catch (error) {
    logger.error({ submissionId: submission.id, errorName: error instanceof Error ? error.name : "unknown" }, "submission check failed");
    if (job.finalAttempt) {
      await technicalFailure(error instanceof Error ? error.name : "unknown");
      return;
    }
    throw error;
  }
}
