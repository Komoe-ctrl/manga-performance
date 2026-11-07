import { createLogger } from "@manga/core";
import { Prisma, type PrismaClient } from "@manga/db";
import { DomainError } from "../domain-error";
import { recordAudit } from "../repositories/audit";
import type { ObjectStorage } from "../storage/object-storage";

const logger = createLogger({ service: "web" });

export type PrivacyErrorCode = "NOT_FOUND" | "ALREADY_ANONYMIZED" | "INVALID";

export class PrivacyError extends DomainError {
  constructor(code: PrivacyErrorCode, message: string) {
    super(code, message);
    this.name = "PrivacyError";
  }
}

/** Marker kept on an anonymized prospect: it is how a second request is recognised. */
export const ANONYMIZED_MARKER = "anonymized";
export const ANONYMIZED_NAME = "Contact anonymisé";
const placeholderEmail = (id: string) => `anonymise-${id}@anonymise.invalid`;

export interface PrivacyDeps {
  prisma: PrismaClient;
  storage: Pick<ObjectStorage, "delete">;
  now?: () => Date;
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/**
 * Personal data rights, handled locally (spec, section 5, loi 2013-450): export everything
 * held about a contact, and anonymize them irreversibly. Invoices are kept, as accounting
 * law requires, with the client company's legal identity.
 */
export function createPrivacyService({ prisma, storage, now = () => new Date() }: PrivacyDeps) {
  return {
    /** Everything held about a contact, as a JSON-serialisable document. */
    async exportContact(prospectId: string, actorId: string) {
      const prospect = await prisma.prospect.findUnique({
        where: { id: prospectId },
        include: {
          interactions: { orderBy: { occurredAt: "asc" } },
          followUps: { orderBy: { dueAt: "asc" } },
          enrollments: { include: { sequence: { select: { name: true } } } },
          client: {
            include: {
              portalUsers: { select: { name: true, email: true, createdAt: true, disabledAt: true } },
              invoices: { orderBy: { createdAt: "asc" }, include: { lines: { orderBy: { position: "asc" } }, payments: true } },
              deliverables: { select: { title: true, mimeType: true, sizeBytes: true, publishedAt: true } },
              messages: { orderBy: { createdAt: "asc" } },
            },
          },
        },
      });
      if (!prospect) throw new PrivacyError("NOT_FOUND", "Contact introuvable.");
      if (prospect.consentSource === ANONYMIZED_MARKER) {
        throw new PrivacyError("ALREADY_ANONYMIZED", "Ce contact a déjà été anonymisé : il ne reste rien à exporter.");
      }

      const email = prospect.email;
      const [subscription, suppression, emailEvents, scraped] = await Promise.all([
        email ? prisma.newsletterSubscriber.findUnique({ where: { email } }) : null,
        email ? prisma.suppression.findUnique({ where: { email } }) : null,
        email ? prisma.emailEvent.findMany({ where: { email }, orderBy: { occurredAt: "asc" } }) : [],
        email || prospect.phone
          ? prisma.scrapeResult.findMany({
              where: { OR: [...(email ? [{ email }] : []), ...(prospect.phone ? [{ phone: prospect.phone }] : [])] },
            })
          : [],
      ]);

      await recordAudit(prisma, { actorId, action: "privacy.exported", entity: "Prospect", entityId: prospectId });

      return {
        exportedAt: now().toISOString(),
        subject: "Données personnelles détenues par MANGA PERFORMANCE",
        contact: {
          id: prospect.id,
          companyName: prospect.companyName,
          contactName: prospect.contactName,
          email: prospect.email,
          phone: prospect.phone,
          sector: prospect.sector,
          city: prospect.city,
          size: prospect.size,
          need: prospect.need,
          status: prospect.status,
          source: prospect.source,
          estimatedValue: prospect.estimatedValue,
          notes: prospect.notes,
          consent: { at: iso(prospect.consentAt), source: prospect.consentSource },
          createdAt: iso(prospect.createdAt),
        },
        interactions: prospect.interactions.map((i) => ({ type: i.type, summary: i.summary, occurredAt: iso(i.occurredAt) })),
        followUps: prospect.followUps.map((f) => ({ rule: f.rule, dueAt: iso(f.dueAt), doneAt: iso(f.doneAt), cancelledAt: iso(f.cancelledAt), note: f.note })),
        emailSequences: prospect.enrollments.map((e) => ({ sequence: e.sequence.name, status: e.status, enrolledAt: iso(e.enrolledAt) })),
        emailEvents: emailEvents.map((e) => ({ type: e.type, occurredAt: iso(e.occurredAt) })),
        newsletter: subscription
          ? { subscribedAt: iso(subscription.createdAt), confirmedAt: iso(subscription.confirmedAt), unsubscribedAt: iso(subscription.unsubscribedAt) }
          : null,
        suppressionList: suppression ? { reason: suppression.reason, since: iso(suppression.createdAt) } : null,
        collectedByScraper: scraped.map((r) => ({ companyName: r.companyName, sourceUrl: r.sourceUrl, collectedAt: iso(r.collectedAt) })),
        client: prospect.client
          ? {
              legalName: prospect.client.legalName,
              address: prospect.client.address,
              taxId: prospect.client.taxId,
              portalUsers: prospect.client.portalUsers.map((u) => ({ name: u.name, email: u.email, createdAt: iso(u.createdAt), disabledAt: iso(u.disabledAt) })),
              invoices: prospect.client.invoices.map((inv) => ({
                number: inv.number,
                status: inv.status,
                issuedAt: iso(inv.issuedAt),
                totalHt: inv.totalHt,
                totalVat: inv.totalVat,
                totalTtc: inv.totalTtc,
                lines: inv.lines.map((l) => ({ label: l.label, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total })),
                payments: inv.payments.map((p) => ({ amount: p.amount, method: p.method, paidAt: iso(p.paidAt) })),
              })),
              deliverables: prospect.client.deliverables.map((d) => ({ title: d.title, mimeType: d.mimeType, sizeBytes: d.sizeBytes, publishedAt: iso(d.publishedAt) })),
              messages: prospect.client.messages.map((m) => ({ from: m.fromRole, body: m.body, attachmentName: m.attachmentName, at: iso(m.createdAt) })),
            }
          : null,
      };
    },

    /**
     * Irreversible. Personal fields are erased or replaced, the portal access is destroyed,
     * messages and their attachments are removed. Kept: invoices and payments (accounting
     * obligation) with the client company's legal name, address and tax id, and the
     * suppression-list entry, so that someone who asked not to be mailed is never mailed again.
     */
    async anonymizeContact(prospectId: string, actorId: string) {
      const prospect = await prisma.prospect.findUnique({
        where: { id: prospectId },
        include: { client: { include: { portalUsers: { select: { id: true, email: true } } } } },
      });
      if (!prospect) throw new PrivacyError("NOT_FOUND", "Contact introuvable.");
      if (prospect.consentSource === ANONYMIZED_MARKER) {
        throw new PrivacyError("ALREADY_ANONYMIZED", "Ce contact est déjà anonymisé.");
      }

      const at = now();
      const email = prospect.email;
      const phone = prospect.phone;
      const client = prospect.client;
      const userIds = client?.portalUsers.map((u) => u.id) ?? [];
      const userEmails = client?.portalUsers.map((u) => u.email) ?? [];

      const attachmentKeys = client
        ? (await prisma.message.findMany({ where: { clientId: client.id, attachmentKey: { not: null } }, select: { attachmentKey: true } })).map((m) => m.attachmentKey!)
        : [];

      const counts = await prisma.$transaction(async (tx) => {
        await tx.prospect.update({
          where: { id: prospectId },
          data: {
            companyName: ANONYMIZED_NAME,
            companyNameNorm: `anonymise ${prospectId}`,
            contactName: null,
            email: null,
            phone: null,
            city: null,
            notes: null,
            lostReason: null,
            consentAt: null,
            consentSource: ANONYMIZED_MARKER,
            deletedAt: prospect.deletedAt ?? at,
          },
        });
        const interactions = await tx.interaction.updateMany({ where: { prospectId }, data: { summary: "[supprimé]" } });
        await tx.followUp.updateMany({ where: { prospectId, doneAt: null, cancelledAt: null }, data: { cancelledAt: at } });
        await tx.followUp.updateMany({ where: { prospectId }, data: { note: null } });
        await tx.sequenceEnrollment.updateMany({ where: { prospectId, status: "ACTIVE" }, data: { status: "STOPPED", nextSendAt: null } });

        let events = 0;
        let subscribers = 0;
        if (email) {
          events = (await tx.emailEvent.updateMany({ where: { email }, data: { email: placeholderEmail(prospectId), meta: Prisma.DbNull } })).count;
          subscribers = (await tx.newsletterSubscriber.deleteMany({ where: { email } })).count;
        }
        const scraped = await tx.scrapeResult.updateMany({
          where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
          data: { email: null, phone: null },
        });

        let messages = 0;
        if (client) {
          messages = (
            await tx.message.updateMany({
              where: { clientId: client.id },
              data: { body: "[Message supprimé]", attachmentKey: null, attachmentName: null, attachmentMime: null, attachmentSize: null },
            })
          ).count;
          await tx.client.update({ where: { id: client.id }, data: { deletedAt: client.deletedAt ?? at } });
        }
        for (const userId of userIds) {
          await tx.session.deleteMany({ where: { userId } });
          await tx.account.deleteMany({ where: { userId } });
          await tx.twoFactor.deleteMany({ where: { userId } });
          await tx.notification.deleteMany({ where: { userId } });
          await tx.user.update({
            where: { id: userId },
            data: { name: "Utilisateur anonymisé", email: placeholderEmail(userId), image: null, disabledAt: at, failedLoginCount: 0, lockedUntil: null },
          });
        }
        if (userEmails.length > 0) await tx.verification.deleteMany({ where: { identifier: { in: userEmails } } });

        await recordAudit(tx, {
          actorId,
          action: "privacy.anonymized",
          entity: "Prospect",
          entityId: prospectId,
          // Counts only: nothing identifying goes into the journal.
          diff: { interactions: interactions.count, emailEvents: events, newsletterSubscriptions: subscribers, scrapeResults: scraped.count, messages, portalUsers: userIds.length },
        });
        return { interactions: interactions.count, messages, portalUsers: userIds.length };
      });

      // After the commit: a storage failure must not undo the anonymization.
      let filesDeleted = 0;
      for (const key of attachmentKeys) {
        try {
          await storage.delete(key);
          filesDeleted++;
        } catch {
          logger.error({ prospectId }, "attachment deletion failed after anonymization");
        }
      }

      return { ...counts, filesDeleted, invoicesKept: client ? await prisma.invoice.count({ where: { clientId: client.id } }) : 0 };
    },
  };
}

export type PrivacyService = ReturnType<typeof createPrivacyService>;
