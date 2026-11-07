import { getEnqueuer, type Enqueuer } from "../queue";

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

/** Port for the "new lead" alert to the consultant. */
export interface ConsultantNotifier {
  notifyNewLead(notice: NewLeadNotice): Promise<void>;
}

/**
 * Queues one `notifications.fanout` job: the worker creates the in-app notification for
 * every active admin and sends the email, both with retries.
 */
export function createQueuedConsultantNotifier(
  getQueue: () => Promise<Enqueuer> = getEnqueuer,
): ConsultantNotifier {
  return {
    async notifyNewLead(notice) {
      const queue = await getQueue();
      await queue.enqueueFanout({
        type: "NEW_LEAD",
        audience: "ADMINS",
        payload: { prospectId: notice.prospectId, returning: notice.returning },
        email: {
          template: "new-lead",
          to: notice.to,
          data: {
            contactName: notice.contactName,
            companyName: notice.companyName,
            sourceLabel: notice.sourceLabel,
            returning: notice.returning,
            url: `${notice.appUrl.replace(/\/$/, "")}/admin/prospects/${notice.prospectId}`,
          },
        },
      });
    },
  };
}

let notifier: ConsultantNotifier | undefined;

export function getConsultantNotifier(): ConsultantNotifier {
  notifier ??= createQueuedConsultantNotifier();
  return notifier;
}

/** Replaces the notifier (tests). */
export function setConsultantNotifier(next: ConsultantNotifier | undefined): void {
  notifier = next;
}
