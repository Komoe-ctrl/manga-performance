import { verifyToken } from "@manga/core";
import type { PrismaClient } from "@manga/db";

/** 1x1 transparent GIF. */
export const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

async function addressOf(prisma: PrismaClient, enrollmentId: string): Promise<string | null> {
  const enrollment = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollmentId }, select: { prospect: { select: { email: true } } } });
  return enrollment?.prospect.email ?? null;
}

/**
 * Open tracking: the pixel URL carries an HMAC-signed enrolment id and step (spec, 6.7), so
 * nobody can inflate the numbers of an enrolment they do not own. Returns whether it counted.
 */
export async function recordOpen(prisma: PrismaClient, token: string, secret: string, now: Date = new Date()): Promise<boolean> {
  const payload = verifyToken<{ e?: string; s?: number }>("open", token, secret);
  if (!payload?.e) return false;
  const email = await addressOf(prisma, payload.e);
  if (!email) return false;
  await prisma.emailEvent.create({
    data: { messageId: `open:${payload.e}:${payload.s ?? 0}`, enrollmentId: payload.e, email, type: "OPENED", occurredAt: now, meta: { step: payload.s ?? null } },
  });
  return true;
}

/**
 * Click tracking: the destination is part of what is signed, so this can never be turned
 * into an open redirect. Returns the URL to send the visitor to, or `null`.
 */
export async function recordClick(prisma: PrismaClient, token: string, secret: string, now: Date = new Date()): Promise<string | null> {
  const payload = verifyToken<{ e?: string; s?: number; u?: string }>("click", token, secret);
  if (!payload?.e || typeof payload.u !== "string" || !/^https?:\/\//i.test(payload.u)) return null;
  const email = await addressOf(prisma, payload.e);
  if (email) {
    await prisma.emailEvent.create({
      data: { messageId: `click:${payload.e}:${payload.s ?? 0}`, enrollmentId: payload.e, email, type: "CLICKED", occurredAt: now, meta: { step: payload.s ?? null, url: payload.u } },
    });
  }
  // A genuine link still works if the enrolment was deleted meanwhile.
  return payload.u;
}
