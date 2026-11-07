import { PermanentEmailError, parseAddress, type EmailProvider, type OutboundEmail } from "./provider";

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/** Brevo transactional API (https://developers.brevo.com/reference/sendtransacemail). */
export class BrevoProvider implements EmailProvider {
  readonly name = "brevo";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(email: OutboundEmail): Promise<{ messageId: string }> {
    const sender = parseAddress(email.from);
    const response = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender,
        to: [{ email: email.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        ...(email.headers ? { headers: email.headers } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // Never include the request: it carries the recipient and the message.
      const detail = `Brevo answered ${response.status}`;
      // 429 and 5xx are worth retrying; other 4xx (bad key, bad address) are not.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new PermanentEmailError(detail);
      }
      throw new Error(detail);
    }
    const body = (await response.json().catch(() => ({}))) as { messageId?: string };
    return { messageId: body.messageId ?? "unknown" };
  }
}
