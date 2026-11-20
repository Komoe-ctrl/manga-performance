import { computeCpraForPeriod } from "@manga/db/cpra";
import type { WorkerDeps } from "../deps";

/**
 * Job `hotel.compute` (avenant n°1, §11 bis) : calcule les écarts CPRO / CPRA d'une période dont le dépôt
 * vient d'être accepté. Idempotent : un dépôt déjà calculé n'est pas recalculé (le recalcul explicite est
 * une action du consultant).
 */
export async function handleHotelCompute(job: { periodId: string }, deps: Pick<WorkerDeps, "prisma" | "logger">): Promise<void> {
  const outcome = await computeCpraForPeriod(deps.prisma, { periodId: job.periodId, actorId: null, force: false });
  if (outcome.computed) deps.logger.info({ periodId: job.periodId, version: outcome.version, results: outcome.results, skipped: outcome.skipped.length }, "cpra computed");
  else deps.logger.info({ periodId: job.periodId, reason: outcome.reason }, "cpra not computed");
}
