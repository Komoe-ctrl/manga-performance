import type { Prisma } from "@manga/db";
import { fanoutJobSchema } from "@manga/emails/jobs";
import type { WorkerDeps } from "../deps";

/**
 * `notifications.fanout`: in-app notifications for the audience, plus one optional
 * email. Idempotent: a retried job (same id) never notifies twice.
 */
export async function handleFanout(
  job: { id: string; data: unknown },
  deps: WorkerDeps,
): Promise<void> {
  const parsed = fanoutJobSchema.safeParse(job.data);
  if (!parsed.success) {
    deps.logger.error("fan-out job dropped: invalid payload");
    return;
  }
  const { type, audience, payload, email } = parsed.data;

  const recipients = await deps.prisma.user.findMany({
    where: {
      disabledAt: null,
      ...(audience === "ADMINS" ? { role: "ADMIN" } : { id: audience.userId }),
    },
    select: { id: true },
  });

  const already = await deps.prisma.notification.findMany({
    where: { type, payload: { path: ["_job"], equals: job.id } },
    select: { userId: true },
  });
  const done = new Set(already.map((row) => row.userId));
  const missing = recipients.filter((user) => !done.has(user.id));

  if (missing.length > 0) {
    await deps.prisma.notification.createMany({
      data: missing.map((user) => ({
        userId: user.id,
        type,
        payload: { ...payload, _job: job.id } as Prisma.InputJsonValue,
      })),
    });
  }
  if (email) await deps.queue.enqueueEmail(email, { dedupeKey: `fanout:${job.id}` });
  deps.logger.info({ type, notified: missing.length }, "notifications fanned out");
}
