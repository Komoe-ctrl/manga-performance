import { createLogger, hmacHex, safeEqualStrings } from "@manga/core";
import { suppressEmail, type SuppressionReason } from "@manga/db/marketing";
import type { PrismaClient } from "@manga/db";

const logger = createLogger({ service: "web" });
const MAX_BODY_BYTES = 1_000_000;

/**
 * The provider must prove it is the sender (spec, section 5). Two accepted proofs, both
 * compared in constant time against `BREVO_WEBHOOK_SECRET`:
 * - `Authorization: Bearer <secret>`: the header configured on the webhook in the provider;
 * - `X-Webhook-Signature: <hex HMAC-SHA256 of the raw body>`: for providers that sign.
 */
export function isAuthentic(headers: Headers, rawBody: string, secret: string): boolean {
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.get("authorization") ?? "")?.[1];
  if (bearer && safeEqualStrings(bearer.trim(), secret)) return true;
  const signature = headers.get("x-webhook-signature")?.replace(/^sha256=/i, "");
  return Boolean(signature && safeEqualStrings(signature.toLowerCase(), hmacHex(rawBody, secret)));
}

interface ProviderEvent {
  event?: string;
  email?: string;
  "message-id"?: string;
  messageId?: string;
  ts_event?: number;
  ts?: number;
  date?: string;
}

type Mapped = { type: "DELIVERED" | "BOUNCED" | "COMPLAINED" | "UNSUBSCRIBED"; suppress?: SuppressionReason };

/** Provider event names -> our event types. Opens and clicks are tracked by us, not by the provider. */
const EVENTS: Record<string, Mapped> = {
  delivered: { type: "DELIVERED" },
  hard_bounce: { type: "BOUNCED", suppress: "HARD_BOUNCE" },
  hardbounce: { type: "BOUNCED", suppress: "HARD_BOUNCE" },
  invalid_email: { type: "BOUNCED", suppress: "HARD_BOUNCE" },
  blocked: { type: "BOUNCED", suppress: "HARD_BOUNCE" },
  soft_bounce: { type: "BOUNCED" },
  softbounce: { type: "BOUNCED" },
  spam: { type: "COMPLAINED", suppress: "COMPLAINT" },
  complaint: { type: "COMPLAINED", suppress: "COMPLAINT" },
  unsubscribe: { type: "UNSUBSCRIBED", suppress: "UNSUBSCRIBED" },
  unsubscribed: { type: "UNSUBSCRIBED", suppress: "UNSUBSCRIBED" },
};

export interface WebhookResult {
  recorded: number;
  suppressed: number;
  ignored: number;
}

/**
 * Applies provider events: records them against the message they belong to, and puts the
 * address on the suppression list on a hard bounce, a complaint or an unsubscribe.
 * Safe to receive twice: an event already recorded for a message is not recorded again,
 * and suppression is idempotent.
 */
export async function processEmailEvents(prisma: PrismaClient, events: ProviderEvent[], now: Date = new Date()): Promise<WebhookResult> {
  const result: WebhookResult = { recorded: 0, suppressed: 0, ignored: 0 };

  for (const event of events) {
    const mapped = EVENTS[String(event.event ?? "").toLowerCase()];
    const email = event.email?.trim().toLowerCase();
    if (!mapped || !email) {
      result.ignored++;
      continue;
    }
    const messageId = (event["message-id"] ?? event.messageId ?? "").trim();
    const occurredAt = event.ts_event ? new Date(event.ts_event * 1000) : event.ts ? new Date(event.ts * 1000) : now;

    if (mapped.suppress) {
      await suppressEmail(prisma, email, mapped.suppress, now);
      result.suppressed++;
    }

    if (messageId) {
      const duplicate = await prisma.emailEvent.findFirst({ where: { messageId, type: mapped.type }, select: { id: true } });
      if (duplicate) continue;
      const sent = await prisma.emailEvent.findFirst({ where: { messageId, type: "SENT" }, select: { enrollmentId: true } });
      await prisma.emailEvent.create({
        data: { messageId, enrollmentId: sent?.enrollmentId ?? null, email, type: mapped.type, occurredAt, meta: { provider: event.event ?? null } },
      });
      result.recorded++;
    }
  }
  return result;
}

/** `POST /api/webhooks/email`. 401 without a valid proof; 200 once the events are applied. */
export async function handleEmailWebhook(request: Request, deps: { prisma: PrismaClient; secret: string }): Promise<Response> {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return Response.json({ error: "TOO_LARGE" }, { status: 413 });
  // Authenticate before reading anything else.
  if (!isAuthentic(request.headers, body, deps.secret)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  const events = (Array.isArray(parsed) ? parsed : [parsed]).filter((e): e is ProviderEvent => typeof e === "object" && e !== null);

  try {
    return Response.json({ ok: true, ...(await processEmailEvents(deps.prisma, events)) });
  } catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "email webhook failed");
    // A 5xx makes the provider retry, which is what we want for a transient failure.
    return Response.json({ error: "INTERNAL" }, { status: 500 });
  }
}
