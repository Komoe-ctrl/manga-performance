import { getEnqueuer, type Enqueuer } from "../queue";

/** Port for the transactional emails the auth flows need. */
export interface AuthMailer {
  sendInvitation(input: { to: string; name: string; url: string; expiresAt: Date }): Promise<void>;
  sendPasswordReset(input: { to: string; name: string; url: string }): Promise<void>;
}

/**
 * Queues the emails (`email.send`): the worker renders the React Email template and
 * sends it through the configured provider, with retries (spec, sections 7 and 8).
 */
export function createQueuedAuthMailer(getQueue: () => Promise<Enqueuer> = getEnqueuer): AuthMailer {
  return {
    async sendInvitation({ to, name, url, expiresAt }) {
      const queue = await getQueue();
      await queue.enqueueEmail({
        template: "invitation",
        to,
        data: { name, url, expiresAt: expiresAt.toISOString() },
      });
    },
    async sendPasswordReset({ to, name, url }) {
      const queue = await getQueue();
      await queue.enqueueEmail({ template: "password-reset", to, data: { name, url } });
    },
  };
}

let mailer: AuthMailer | undefined;

export function getAuthMailer(): AuthMailer {
  mailer ??= createQueuedAuthMailer();
  return mailer;
}

/** Replaces the mailer (tests). */
export function setAuthMailer(next: AuthMailer | undefined): void {
  mailer = next;
}
