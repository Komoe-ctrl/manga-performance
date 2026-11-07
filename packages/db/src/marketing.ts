import type { PrismaClient } from "./generated/client";

export type SuppressionReason = "UNSUBSCRIBED" | "HARD_BOUNCE" | "COMPLAINT" | "MANUAL";

/** What an active enrolment becomes when its address is suppressed. */
const ENROLLMENT_STATUS = {
  UNSUBSCRIBED: "UNSUBSCRIBED",
  HARD_BOUNCE: "BOUNCED",
  COMPLAINT: "BOUNCED",
  MANUAL: "STOPPED",
} as const satisfies Record<SuppressionReason, string>;

const normalize = (email: string) => email.trim().toLowerCase();

export async function isSuppressed(prisma: PrismaClient, email: string): Promise<SuppressionReason | null> {
  const row = await prisma.suppression.findUnique({ where: { email: normalize(email) } });
  return (row?.reason as SuppressionReason | undefined) ?? null;
}

/**
 * Global exclusion list: from now on no marketing email goes to this address (spec, 6.7).
 * Idempotent, and it never downgrades: an address already suppressed keeps its first reason
 * (a hard bounce stays a hard bounce even if the person also unsubscribes).
 * Active sequence enrolments of the matching prospects stop, and the newsletter
 * subscription is closed on unsubscribe.
 */
export async function suppressEmail(
  prisma: PrismaClient,
  email: string,
  reason: SuppressionReason,
  now: Date = new Date(),
): Promise<{ enrollmentsStopped: number }> {
  const address = normalize(email);
  await prisma.suppression.upsert({
    where: { email: address },
    create: { email: address, reason, createdAt: now },
    update: {},
  });

  const { count } = await prisma.sequenceEnrollment.updateMany({
    where: { status: "ACTIVE", prospect: { email: address } },
    data: { status: ENROLLMENT_STATUS[reason], nextSendAt: null },
  });
  if (reason === "UNSUBSCRIBED") {
    await prisma.newsletterSubscriber.updateMany({ where: { email: address, unsubscribedAt: null }, data: { unsubscribedAt: now } });
  }
  return { enrollmentsStopped: count };
}

/**
 * A fresh double opt-in is explicit new consent: it lifts an unsubscribe. A bounce, a
 * complaint or a manual exclusion is never lifted by the subscriber themselves.
 */
export async function liftUnsubscribe(prisma: PrismaClient, email: string): Promise<boolean> {
  const { count } = await prisma.suppression.deleteMany({ where: { email: normalize(email), reason: "UNSUBSCRIBED" } });
  return count === 1;
}
