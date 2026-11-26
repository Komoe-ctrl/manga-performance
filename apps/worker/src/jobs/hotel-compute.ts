import { CPRA_TEMPLATE_ID, computeCpraForPeriod } from "@manga/db/cpra";
import { HOTEL_KPI_TEMPLATE_ID, computeHotelKpisForPeriod, notifyConsultantOfHotelAlerts } from "@manga/db/hotel-kpi";
import type { WorkerDeps } from "../deps";

/**
 * Job `hotel.compute` (avenant n°1, §11 bis) : calcule, pour la période dont le dépôt vient d'être accepté,
 * soit les écarts CPRO / CPRA, soit les KPI de `hotel_mensuel`. Idempotent : un dépôt déjà calculé n'est pas
 * recalculé (le recalcul explicite est une action du consultant). Les alertes KPI vont au consultant, jamais au client.
 */
export async function handleHotelCompute(job: { periodId: string }, deps: Pick<WorkerDeps, "prisma" | "logger" | "queue" | "env">): Promise<void> {
  const period = await deps.prisma.collectionPeriod.findUnique({
    where: { id: job.periodId },
    select: { plan: { select: { templateId: true } } },
  });
  if (!period) {
    deps.logger.info({ periodId: job.periodId, reason: "NOT_FOUND" }, "hotel computation not run");
    return;
  }

  if (period.plan.templateId === CPRA_TEMPLATE_ID) {
    const outcome = await computeCpraForPeriod(deps.prisma, { periodId: job.periodId, actorId: null, force: false });
    if (outcome.computed) deps.logger.info({ periodId: job.periodId, version: outcome.version, results: outcome.results, skipped: outcome.skipped.length }, "cpra computed");
    else deps.logger.info({ periodId: job.periodId, reason: outcome.reason }, "cpra not computed");
    return;
  }

  if (period.plan.templateId === HOTEL_KPI_TEMPLATE_ID) {
    const outcome = await computeHotelKpisForPeriod(deps.prisma, { periodId: job.periodId, actorId: null, force: false });
    if (!outcome.computed) {
      deps.logger.info({ periodId: job.periodId, reason: outcome.reason }, "hotel KPIs not computed");
      return;
    }
    deps.logger.info({ periodId: job.periodId, version: outcome.version, alerts: outcome.alerts.length }, "hotel KPIs computed");
    try {
      const sent = await notifyConsultantOfHotelAlerts(deps.queue, {
        to: deps.env.ADMIN_NOTIFICATION_EMAIL,
        appUrl: deps.env.APP_URL,
        periodId: job.periodId,
        version: outcome.version,
        context: outcome.context,
        kpis: outcome.kpis,
        alerts: outcome.alerts,
      });
      if (sent) deps.logger.info({ periodId: job.periodId, version: outcome.version }, "hotel KPI alert sent to consultant");
    } catch (error) {
      // The result is already stored and idempotent; a failed enqueue must not undo it. Recompute to resend.
      deps.logger.error({ periodId: job.periodId, errorName: error instanceof Error ? error.name : "unknown" }, "hotel KPI alert not queued");
    }
    return;
  }

  deps.logger.info({ periodId: job.periodId, templateId: period.plan.templateId }, "hotel computation not run");
}
