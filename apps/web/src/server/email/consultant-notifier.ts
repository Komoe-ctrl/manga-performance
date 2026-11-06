import { getEnv } from "@manga/core/env";

export interface NewLeadNotice {
  to: string;
  prospectId: string;
  /** Existing prospect contacted us again (no duplicate was created). */
  returning: boolean;
  sourceLabel: string;
  companyName: string;
  contactName: string;
  appUrl: string;
}

/**
 * Port for the "new lead" email to the consultant. The Brevo + React Email
 * implementation, queued through pg-boss, arrives with step 5.
 */
export interface ConsultantNotifier {
  notifyNewLead(notice: NewLeadNotice): Promise<void>;
}

/** Development stand-in: prints a one-line summary (no contact details). */
export class ConsoleConsultantNotifier implements ConsultantNotifier {
  async notifyNewLead(notice: NewLeadNotice) {
    if (getEnv().NODE_ENV === "production") {
      throw new Error("No email provider configured: transactional emails arrive with step 5.");
    }
    const kind = notice.returning ? "returning contact" : "new lead";
    console.info(`[DEV MAIL] ${kind} via ${notice.sourceLabel}: ${notice.appUrl}/admin/prospects/${notice.prospectId}`);
  }
}

let notifier: ConsultantNotifier | undefined;

export function getConsultantNotifier(): ConsultantNotifier {
  notifier ??= new ConsoleConsultantNotifier();
  return notifier;
}

/** Replaces the notifier (tests, and the real provider from step 5). */
export function setConsultantNotifier(next: ConsultantNotifier | undefined): void {
  notifier = next;
}
