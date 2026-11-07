import { MAX_REMINDERS, amountDue, isReminderDue } from "@manga/core/invoice";
import type { PrismaClient } from "./generated/client";
import type { JobQueue } from "./queue";

const REMINDABLE = ["EMISE", "PARTIELLEMENT_PAYEE", "EN_RETARD"] as const;
const OVERDUE_CANDIDATES = ["EMISE", "PARTIELLEMENT_PAYEE"] as const;

/**
 * `invoices.mark-overdue` (06:00 daily): issued invoices whose due date has passed and
 * that are not fully paid become EN_RETARD. Credit notes are never overdue.
 * Returns the invoice ids that changed.
 */
export async function markOverdueInvoices(prisma: PrismaClient, now: Date): Promise<string[]> {
  const candidates = await prisma.invoice.findMany({
    where: {
      status: { in: [...OVERDUE_CANDIDATES] },
      dueAt: { lt: now },
      creditNoteOfId: null,
    },
    select: { id: true, status: true },
  });

  const changed: string[] = [];
  for (const candidate of candidates) {
    // Guarded on the status we read: a payment recorded meanwhile wins.
    const { count } = await prisma.invoice.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { status: "EN_RETARD" },
    });
    if (count === 1) {
      changed.push(candidate.id);
      await prisma.auditLog.create({
        data: {
          actorId: null,
          action: "invoice.overdue",
          entity: "Invoice",
          entityId: candidate.id,
          diff: { from: candidate.status, to: "EN_RETARD" },
        },
      });
    }
  }
  return changed;
}

export type ReminderOutcome =
  | { sent: true; reminderNumber: number }
  | {
      sent: false;
      reason: "NOT_FOUND" | "NOT_REMINDABLE" | "DISABLED" | "CAP_REACHED" | "NOT_DUE" | "NO_RECIPIENT" | "RACE";
    };

export interface SendReminderOptions {
  prisma: PrismaClient;
  queue: Pick<JobQueue, "enqueueEmail">;
  invoiceId: string;
  appUrl: string;
  now: Date;
  /** `null` for the scheduled job. */
  actorId: string | null;
  /** A manual reminder ignores the schedule and the per-invoice switch, but not the cap of 3. */
  manual: boolean;
}

/**
 * Sends the next payment reminder of an invoice (spec, 6.4): at J+3, J+10 and J+20 after
 * the due date, three at most, each one logged. The counter is claimed atomically before
 * the email is queued, so two workers (or a worker and an admin) never send the same one.
 */
export async function sendInvoiceReminder(options: SendReminderOptions): Promise<ReminderOutcome> {
  const { prisma, queue, invoiceId, appUrl, now, actorId, manual } = options;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: { include: { prospect: true } } },
  });
  if (!invoice) return { sent: false, reason: "NOT_FOUND" };
  if (
    invoice.creditNoteOfId !== null ||
    !(REMINDABLE as readonly string[]).includes(invoice.status) ||
    amountDue(invoice) === 0 ||
    !invoice.number ||
    !invoice.dueAt
  ) {
    return { sent: false, reason: "NOT_REMINDABLE" };
  }
  if (invoice.remindersSent >= MAX_REMINDERS) return { sent: false, reason: "CAP_REACHED" };
  if (!manual) {
    if (invoice.remindersDisabled) return { sent: false, reason: "DISABLED" };
    if (!isReminderDue(invoice.dueAt, invoice.remindersSent, now)) return { sent: false, reason: "NOT_DUE" };
  }

  const prospect = invoice.client.prospect;
  if (!prospect.email) return { sent: false, reason: "NO_RECIPIENT" };

  const reminderNumber = invoice.remindersSent + 1;
  const claimed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.invoice.updateMany({
      where: { id: invoice.id, remindersSent: invoice.remindersSent, status: invoice.status },
      data: { remindersSent: { increment: 1 }, lastReminderAt: now },
    });
    if (count !== 1) return false;
    await tx.auditLog.create({
      data: {
        actorId,
        action: "invoice.reminder_sent",
        entity: "Invoice",
        entityId: invoice.id,
        diff: { reminderNumber, manual },
      },
    });
    return true;
  });
  if (!claimed) return { sent: false, reason: "RACE" };

  try {
    await queue.enqueueEmail(
      {
        template: "payment-reminder",
        to: prospect.email,
        data: {
          name: prospect.contactName ?? prospect.companyName,
          invoiceNumber: invoice.number,
          amountDue: amountDue(invoice),
          dueAt: invoice.dueAt.toISOString(),
          url: `${appUrl.replace(/\/$/, "")}/espace-client`,
        },
      },
      { dedupeKey: `reminder:${invoice.id}:${reminderNumber}` },
    );
  } catch (error) {
    // The email never made it to the queue: give the reminder back so it is retried.
    await prisma.invoice.updateMany({
      where: { id: invoice.id, remindersSent: reminderNumber },
      data: { remindersSent: invoice.remindersSent, lastReminderAt: invoice.lastReminderAt },
    });
    throw error;
  }
  return { sent: true, reminderNumber };
}

/** Invoices whose next automatic reminder may be due: the job checks each one precisely. */
export async function findReminderCandidates(prisma: PrismaClient, now: Date): Promise<string[]> {
  const rows = await prisma.invoice.findMany({
    where: {
      status: { in: [...REMINDABLE] },
      creditNoteOfId: null,
      remindersDisabled: false,
      remindersSent: { lt: MAX_REMINDERS },
      dueAt: { lt: now },
    },
    select: { id: true },
    orderBy: { dueAt: "asc" },
  });
  return rows.map((row) => row.id);
}
