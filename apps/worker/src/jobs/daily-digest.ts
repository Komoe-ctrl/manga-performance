import { bucketFollowUp } from "@manga/core";
import type { WorkerDeps } from "../deps";

const MAX_LISTED = 50;

/**
 * `followups.daily-digest` (07:00 Africa/Abidjan): one email to the consultant with the
 * follow-ups due today and overdue, plus an in-app notification. Nothing is sent on a
 * quiet day. The business day is the dedupe key, so a retry or a double trigger is harmless.
 */
export async function runDailyDigest(deps: WorkerDeps): Promise<{ today: number; overdue: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const tz = deps.env.TZ_DISPLAY;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Superset of "due today or earlier" whatever the timezone; exact bucketing follows.
  const pending = await deps.prisma.followUp.findMany({
    where: {
      doneAt: null,
      cancelledAt: null,
      dueAt: { lt: new Date(now.getTime() + 36 * 3600_000) },
      prospect: { deletedAt: null },
    },
    include: { prospect: { select: { id: true, companyName: true } } },
    orderBy: { dueAt: "asc" },
  });

  const base = deps.env.APP_URL.replace(/\/$/, "");
  const item = (row: (typeof pending)[number]) => ({
    company: row.prospect.companyName,
    rule: row.rule,
    dueAt: row.dueAt.toISOString(),
    url: `${base}/admin/prospects/${row.prospect.id}`,
  });
  const overdue = pending.filter((row) => bucketFollowUp(row.dueAt, now, tz) === "OVERDUE");
  const today = pending.filter((row) => bucketFollowUp(row.dueAt, now, tz) === "TODAY");

  if (overdue.length + today.length === 0) {
    deps.logger.info({ date }, "daily digest: nothing due");
    return { today: 0, overdue: 0 };
  }

  await deps.queue.enqueueFanout(
    {
      type: "FOLLOW_UP_DUE",
      audience: "ADMINS",
      payload: { date, overdue: overdue.length, today: today.length },
      email: {
        template: "daily-digest",
        to: deps.env.ADMIN_NOTIFICATION_EMAIL,
        data: {
          date,
          overdue: overdue.slice(0, MAX_LISTED).map(item),
          today: today.slice(0, MAX_LISTED).map(item),
          adminUrl: `${base}/admin/relances`,
        },
      },
    },
    { dedupeKey: `digest:${date}` },
  );
  deps.logger.info({ date, today: today.length, overdue: overdue.length }, "daily digest queued");
  return { today: today.length, overdue: overdue.length };
}
