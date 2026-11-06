import { BrevoProvider } from "./brevo";
import { DevMailboxProvider } from "./dev-mailbox";
import type { EmailProvider } from "./provider";

export interface ProviderEnv {
  NODE_ENV: "development" | "test" | "production";
  EMAIL_PROVIDER: "brevo" | "resend";
  BREVO_API_KEY: string;
}

/**
 * Picks the email provider. Outside production, the placeholder API key from
 * `.env.example` selects the development mailbox, so nothing is ever sent by accident;
 * a real key sends for real.
 */
export function createEmailProvider(
  env: ProviderEnv,
  options: { mailboxDirectory: string; fetchImpl?: typeof fetch },
): EmailProvider {
  if (env.EMAIL_PROVIDER === "resend") {
    throw new Error("EMAIL_PROVIDER=resend is not implemented yet (Brevo is the supported provider).");
  }
  if (env.NODE_ENV !== "production" && env.BREVO_API_KEY.includes("change-me")) {
    return new DevMailboxProvider(options.mailboxDirectory);
  }
  return new BrevoProvider(env.BREVO_API_KEY, options.fetchImpl);
}
