import {
  DEFAULT_DAILY_CAP,
  NEED_LABELS_FR,
  afterSend,
  applyVariables,
  firstNameOf,
  isInSendWindow,
  signToken,
  startOfLocalDay,
} from "@manga/core";
import { tiptapToHtml } from "@manga/core/rich-text";
import { isSuppressed } from "@manga/db/marketing";
import type { WorkerDeps } from "../deps";

const BATCH = 500;

export interface DispatchResult {
  queued: number;
  stopped: number;
  skipped: number;
  /** Why nothing was considered at all. */
  idle?: "OUTSIDE_WINDOW" | "CAP_REACHED";
}

async function dailyCap(deps: WorkerDeps): Promise<number> {
  const row = await deps.prisma.setting.findUnique({ where: { key: "marketing" } });
  const value = (row?.value as { dailyCap?: unknown } | null)?.dailyCap;
  return typeof value === "number" && value >= 0 ? value : DEFAULT_DAILY_CAP;
}

/**
 * `sequences.dispatch` (every 15 minutes, spec 6.7): sends the next step of every active
 * enrolment that is due, behind the guard-rails, in this order:
 * suppression list, prospect state (client / lost / deleted), sending window
 * (Mon-Fri 08:00-18:00 Abidjan), then the daily cap (domain warm-up, 50 to start).
 */
export async function runSequenceDispatch(deps: WorkerDeps): Promise<DispatchResult> {
  const now = (deps.now ?? (() => new Date()))();
  const tz = deps.env.TZ_DISPLAY;
  const result: DispatchResult = { queued: 0, stopped: 0, skipped: 0 };

  if (!isInSendWindow(now, tz)) {
    deps.logger.info("sequence dispatch: outside the sending window");
    return { ...result, idle: "OUTSIDE_WINDOW" };
  }

  const cap = await dailyCap(deps);
  let queuedToday = await deps.prisma.emailEvent.count({ where: { type: "QUEUED", occurredAt: { gte: startOfLocalDay(now, tz) } } });
  if (queuedToday >= cap) {
    deps.logger.info({ cap }, "sequence dispatch: daily cap reached");
    return { ...result, idle: "CAP_REACHED" };
  }

  const due = await deps.prisma.sequenceEnrollment.findMany({
    where: { status: "ACTIVE", nextSendAt: { lte: now }, sequence: { active: true } },
    include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } }, prospect: true },
    orderBy: { nextSendAt: "asc" },
    take: BATCH,
  });

  const stop = async (id: string, status: "STOPPED" | "COMPLETED" | "UNSUBSCRIBED" | "BOUNCED") => {
    await deps.prisma.sequenceEnrollment.updateMany({ where: { id, status: "ACTIVE" }, data: { status, nextSendAt: null } });
    result.stopped++;
  };

  const base = deps.env.APP_URL.replace(/\/$/, "");
  const secret = deps.env.TRACKING_HMAC_SECRET;

  for (const enrollment of due) {
    if (queuedToday >= cap) break;
    const { prospect, sequence } = enrollment;

    if (prospect.deletedAt || prospect.status === "CLIENT" || prospect.status === "PERDU") {
      await stop(enrollment.id, "STOPPED");
      continue;
    }
    if (!prospect.email) {
      await stop(enrollment.id, "STOPPED");
      continue;
    }
    const suppressed = await isSuppressed(deps.prisma, prospect.email);
    if (suppressed) {
      await stop(enrollment.id, suppressed === "UNSUBSCRIBED" ? "UNSUBSCRIBED" : suppressed === "MANUAL" ? "STOPPED" : "BOUNCED");
      continue;
    }
    const step = sequence.steps[enrollment.currentStep];
    if (!step) {
      await stop(enrollment.id, "COMPLETED");
      continue;
    }

    let html: string;
    try {
      html = tiptapToHtml(step.bodyJson, {
        rewriteLink: (href) => `${base}/api/t/c/${signToken("click", { e: enrollment.id, s: step.order, u: href }, secret)}`,
      });
    } catch {
      deps.logger.error({ enrollmentId: enrollment.id, step: step.order }, "sequence step has an invalid body: enrolment stopped");
      await stop(enrollment.id, "STOPPED");
      continue;
    }

    const values = {
      prenom: firstNameOf(prospect.contactName),
      // A newsletter subscriber has no company: the address stands in, never print it.
      entreprise: prospect.companyName.includes("@") ? undefined : prospect.companyName,
      secteur: prospect.sector === "Non précisé" ? undefined : prospect.sector,
      besoin: prospect.need ? NEED_LABELS_FR[prospect.need] : undefined,
    };
    const subject = applyVariables(step.subject, values);
    const bodyHtml = applyVariables(html, values, { escape: true });

    // Claim and advance first (guarded on the step we read), then queue; undo if queuing fails.
    const next = afterSend(sequence.steps, enrollment.currentStep, now);
    const key = `seq:${enrollment.id}:${step.order}`;
    const claimed = await deps.prisma.$transaction(async (tx) => {
      const { count } = await tx.sequenceEnrollment.updateMany({
        where: { id: enrollment.id, status: "ACTIVE", currentStep: enrollment.currentStep },
        data: next,
      });
      if (count !== 1) return false;
      await tx.emailEvent.create({ data: { messageId: key, enrollmentId: enrollment.id, email: prospect.email!, type: "QUEUED", occurredAt: now } });
      return true;
    });
    if (!claimed) {
      result.skipped++;
      continue;
    }

    try {
      await deps.queue.enqueueEmail(
        {
          template: "marketing",
          to: prospect.email,
          enrollmentId: enrollment.id,
          data: {
            subject,
            bodyHtml,
            unsubscribeUrl: `${base}/api/newsletter/unsubscribe?token=${signToken("unsub", { email: prospect.email }, secret)}`,
            pixelUrl: `${base}/api/t/o/${signToken("open", { e: enrollment.id, s: step.order }, secret)}`,
          },
        },
        { dedupeKey: key },
      );
      result.queued++;
      queuedToday++;
    } catch (error) {
      await deps.prisma.$transaction([
        deps.prisma.sequenceEnrollment.updateMany({
          where: { id: enrollment.id },
          data: { status: "ACTIVE", currentStep: enrollment.currentStep, nextSendAt: enrollment.nextSendAt },
        }),
        deps.prisma.emailEvent.deleteMany({ where: { messageId: key, type: "QUEUED" } }),
      ]);
      deps.logger.error({ enrollmentId: enrollment.id, errorName: error instanceof Error ? error.name : "unknown" }, "sequence email could not be queued");
      result.skipped++;
    }
  }

  deps.logger.info(result, "sequence dispatch done");
  return result;
}

/** `newsletter.purge-unconfirmed` (daily): signups never confirmed within 7 days are deleted. */
export async function runPurgeUnconfirmed(deps: WorkerDeps): Promise<{ purged: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const { count } = await deps.prisma.newsletterSubscriber.deleteMany({
    where: { confirmedAt: null, createdAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } },
  });
  deps.logger.info({ purged: count }, "unconfirmed newsletter signups purged");
  return { purged: count };
}
