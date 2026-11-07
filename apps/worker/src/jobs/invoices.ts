import { findReminderCandidates, markOverdueInvoices, sendInvoiceReminder } from "@manga/db/billing-jobs";
import type { WorkerDeps } from "../deps";

/** `invoices.mark-overdue` (06:00 daily): unpaid invoices past their due date become EN_RETARD. */
export async function runMarkOverdue(deps: WorkerDeps): Promise<{ marked: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const changed = await markOverdueInvoices(deps.prisma, now);
  deps.logger.info({ marked: changed.length }, "overdue invoices marked");
  return { marked: changed.length };
}

/**
 * `invoices.payment-reminders` (09:00 daily): the next reminder (J+3, J+10, J+20 after the
 * due date, 3 at most) for every overdue invoice that is due one. One failing invoice
 * never blocks the others; it is counted and logged, and retried by the next run.
 */
export async function runPaymentReminders(
  deps: WorkerDeps,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const candidates = await findReminderCandidates(deps.prisma, now);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const invoiceId of candidates) {
    try {
      const outcome = await sendInvoiceReminder({
        prisma: deps.prisma,
        queue: deps.queue,
        invoiceId,
        appUrl: deps.env.APP_URL,
        now,
        actorId: null,
        manual: false,
      });
      if (outcome.sent) sent++;
      else {
        skipped++;
        if (outcome.reason === "NO_RECIPIENT") deps.logger.warn({ invoiceId }, "reminder skipped: no contact email");
      }
    } catch (error) {
      failed++;
      deps.logger.error({ invoiceId, errorName: error instanceof Error ? error.name : "unknown" }, "reminder failed");
    }
  }
  deps.logger.info({ sent, skipped, failed }, "payment reminders processed");
  return { sent, skipped, failed };
}
