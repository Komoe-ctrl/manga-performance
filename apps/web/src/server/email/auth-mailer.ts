import { getEnv } from "@manga/core/env";

/**
 * Port for the transactional emails the auth flows need. The real implementation
 * (Brevo + React Email, queued through pg-boss) arrives with step 5.
 */
export interface AuthMailer {
  sendInvitation(input: { to: string; name: string; url: string; expiresAt: Date }): Promise<void>;
  sendPasswordReset(input: { to: string; name: string; url: string }): Promise<void>;
}

/**
 * Development stand-in: prints the link to the terminal so flows can be tried by
 * hand. It refuses to run in production, where leaking a token to logs is not acceptable.
 */
export class ConsoleAuthMailer implements AuthMailer {
  async sendInvitation(input: { to: string; url: string }) {
    this.print("invitation", input.to, input.url);
  }
  async sendPasswordReset(input: { to: string; url: string }) {
    this.print("password reset", input.to, input.url);
  }
  private print(kind: string, to: string, url: string) {
    if (getEnv().NODE_ENV === "production") {
      throw new Error("No email provider configured: transactional emails arrive with step 5.");
    }
    // Deliberately not the pino logger: tokens must never reach structured logs.
    console.info(`[DEV MAIL] ${kind} for ${to}\n  ${url}`);
  }
}

let mailer: AuthMailer | undefined;

export function getAuthMailer(): AuthMailer {
  mailer ??= new ConsoleAuthMailer();
  return mailer;
}

/** Replaces the mailer (tests, and the real provider from step 5). */
export function setAuthMailer(next: AuthMailer | undefined): void {
  mailer = next;
}
