import { createLogger, generateToken, hashToken, normalizeEmail } from "@manga/core";
import { isSuppressed, liftUnsubscribe, suppressEmail } from "@manga/db/marketing";
import type { PrismaClient } from "@manga/db";
import type { NewsletterSubscriber } from "@/lib/types";
import type { CrmService } from "../crm/crm-service";
import type { Enqueuer } from "../queue";
import type { SequencesService } from "./sequences-service";

const CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000;
const logger = createLogger({ service: "web" });

export interface NewsletterDeps {
  prisma: PrismaClient;
  queue: Pick<Enqueuer, "enqueueEmail">;
  crm: Pick<CrmService, "ingestLead">;
  sequences: Pick<SequencesService, "enrollNewsletterSignup">;
  appUrl: string;
  now?: () => Date;
}

export type ConfirmResult = "confirmed" | "expired" | "invalid";

/**
 * Newsletter with double opt-in (spec, 6.6). Nobody is subscribed before clicking the link
 * in the confirmation email; unsubscribing is one click and puts the address on the global
 * suppression list.
 */
export function createNewsletterService({ prisma, queue, crm, sequences, appUrl, now = () => new Date() }: NewsletterDeps) {
  const base = appUrl.replace(/\/$/, "");

  return {
    /**
     * Starts a subscription. It never reveals whether the address is already known: every
     * path looks the same from outside. A confirmation email is only sent when there is
     * something to confirm, and never to an address excluded for a bounce or a complaint.
     */
    async subscribe(input: { email: string; ip: string }): Promise<void> {
      const email = normalizeEmail(input.email);
      const suppressed = await isSuppressed(prisma, email);
      if (suppressed && suppressed !== "UNSUBSCRIBED") return;

      const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });
      if (existing?.confirmedAt && !existing.unsubscribedAt && !suppressed) return; // already subscribed

      const token = generateToken();
      const at = now();
      const confirmTokenHash = hashToken(token);
      const confirmExpiresAt = new Date(at.getTime() + CONFIRMATION_TTL_MS);
      const consentIp = input.ip === "unknown" ? null : input.ip;

      await prisma.newsletterSubscriber.upsert({
        where: { email },
        create: { email, confirmTokenHash, confirmExpiresAt, consentIp, createdAt: at },
        // The previous state stays as it is until the new link is clicked.
        update: { confirmTokenHash, confirmExpiresAt, consentIp },
      });
      await queue.enqueueEmail({ template: "newsletter-confirmation", to: email, data: { url: `${base}/api/newsletter/confirm?token=${encodeURIComponent(token)}` } });
    },

    /** Confirms a subscription from the emailed token (single use, 48 h). */
    async confirm(token: string): Promise<ConfirmResult> {
      if (!token || token.length > 200) return "invalid";
      const hash = hashToken(token);
      const subscriber = await prisma.newsletterSubscriber.findFirst({ where: { confirmTokenHash: hash } });
      if (!subscriber) return "invalid";
      const at = now();
      if (!subscriber.confirmExpiresAt || subscriber.confirmExpiresAt.getTime() < at.getTime()) return "expired";

      const { count } = await prisma.newsletterSubscriber.updateMany({
        where: { id: subscriber.id, confirmTokenHash: hash },
        data: { confirmedAt: at, confirmTokenHash: null, confirmExpiresAt: null, unsubscribedAt: null },
      });
      if (count !== 1) return "invalid"; // someone else just used it

      // Explicit new consent lifts an earlier unsubscribe (never a bounce or a complaint).
      await liftUnsubscribe(prisma, subscriber.email);

      try {
        const lead = await crm.ingestLead({ source: "newsletter", sourceLabel: "la newsletter", email: subscriber.email });
        await sequences.enrollNewsletterSignup(lead.prospectId);
      } catch (error) {
        // The subscription itself is confirmed: do not fail it over the CRM.
        logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "newsletter confirmation: CRM step failed");
      }
      return "confirmed";
    },

    /** Unsubscribes an address: suppression list, active sequences stopped, subscription closed. */
    async unsubscribe(email: string): Promise<{ enrollmentsStopped: number }> {
      return suppressEmail(prisma, normalizeEmail(email), "UNSUBSCRIBED", now());
    },

    async listSubscribers(): Promise<NewsletterSubscriber[]> {
      const rows = await prisma.newsletterSubscriber.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        confirmed: row.confirmedAt !== null,
        subscribedAt: row.createdAt.toISOString(),
        unsubscribedAt: row.unsubscribedAt?.toISOString(),
      }));
    },
  };
}

export type NewsletterService = ReturnType<typeof createNewsletterService>;
