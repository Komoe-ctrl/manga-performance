import { localDay } from "@manga/core/collection";
import {
  buildWeeklyDigest,
  findPeriodReminderCandidates,
  loadReminderRules,
  markLatePeriods,
  openPeriods,
  sendPeriodReminder,
} from "@manga/db/collection-jobs";
import type { WorkerDeps } from "../deps";

const clock = (deps: WorkerDeps) => (deps.now ?? (() => new Date()))();

/** `collection.open-periods` (05:00) : crée les périodes attendues à la fin de chaque période. */
export async function runOpenPeriods(deps: WorkerDeps): Promise<{ created: number }> {
  const today = localDay(clock(deps), deps.env.TZ_DISPLAY);
  const created = await openPeriods(deps.prisma, today);
  deps.logger.info({ created }, "collection periods opened");
  return { created };
}

/** `collection.mark-late` (06:00) : les périodes attendues dont l'échéance est passée passent en retard. */
export async function runMarkLate(deps: WorkerDeps): Promise<{ marked: number }> {
  const today = localDay(clock(deps), deps.env.TZ_DISPLAY);
  const marked = await markLatePeriods(deps.prisma, today);
  deps.logger.info({ marked }, "late collection periods marked");
  return { marked };
}

/**
 * `collection.reminders` (toutes les heures, n'agit qu'à l'heure réglée, 08:00 par défaut) : la relance
 * due de chaque période attendue ou en retard. Une période en échec n'empêche pas les autres ; elle est
 * comptée, journalisée, et reprise au prochain passage.
 */
export async function runReminders(deps: WorkerDeps): Promise<{ sent: number; skipped: number; failed: number }> {
  const now = clock(deps);
  const rules = await loadReminderRules(deps.prisma);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: deps.env.TZ_DISPLAY, hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour !== rules.sendHour) return { sent: 0, skipped: 0, failed: 0 };

  const today = localDay(now, deps.env.TZ_DISPLAY);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const periodId of await findPeriodReminderCandidates(deps.prisma, today, rules)) {
    try {
      const outcome = await sendPeriodReminder({ prisma: deps.prisma, queue: deps.queue, periodId, appUrl: deps.env.APP_URL, today, now, rules, actorId: null, manual: false });
      if (outcome.sent) sent++;
      else {
        skipped++;
        if (outcome.reason === "NO_RECIPIENT") deps.logger.warn({ periodId }, "collection reminder skipped: nobody to remind");
      }
    } catch (error) {
      failed++;
      deps.logger.error({ periodId, errorName: error instanceof Error ? error.name : "unknown" }, "collection reminder failed");
    }
  }
  deps.logger.info({ sent, skipped, failed }, "collection reminders processed");
  return { sent, skipped, failed };
}

/**
 * `collection.weekly-digest` (lundi 07:00) : complétude de la semaine écoulée, retards et rejets, au
 * consultant. Rien n'est envoyé s'il n'y a rien à signaler. La semaine est la clé de dédoublonnage.
 */
export async function runWeeklyDigest(deps: WorkerDeps): Promise<{ sent: boolean }> {
  const today = localDay(clock(deps), deps.env.TZ_DISPLAY);
  const digest = await buildWeeklyDigest(deps.prisma, today);
  if (digest.expected === 0 && digest.late.length === 0 && digest.rejected.length === 0) {
    deps.logger.info("collection weekly digest: nothing to report");
    return { sent: false };
  }
  const weekOf = digest.weekOf.toISOString().slice(0, 10);
  await deps.queue.enqueueFanout(
    {
      type: "COLLECTION_WEEKLY_DIGEST",
      audience: "ADMINS",
      payload: { weekOf, expected: digest.expected, received: digest.received, late: digest.late.length, rejected: digest.rejected.length },
      email: {
        template: "collection-weekly-digest",
        to: deps.env.ADMIN_NOTIFICATION_EMAIL,
        data: { weekOf, expected: digest.expected, received: digest.received, late: digest.late, rejected: digest.rejected, adminUrl: `${deps.env.APP_URL.replace(/\/$/, "")}/admin/collecte` },
      },
    },
    { dedupeKey: `collection-weekly:${weekOf}` },
  );
  return { sent: true };
}
