import { createLogger } from "@manga/core";
import type { PrismaClient } from "@manga/db";
import { leadSchema, type LeadSource } from "@manga/validation";
import { LIMITS, RateLimitError, clientIp, consume } from "../auth/rate-limit";
import { CrmError } from "../crm/errors";
import type { CrmService } from "../crm/crm-service";
import type { ConsultantNotifier } from "../email/consultant-notifier";
import { verifyTurnstile } from "../security/turnstile";

const MAX_BODY_BYTES = 20_000;

const SOURCE_LABELS: Record<LeadSource, string> = {
  site_formulaire: "le formulaire de contact",
  chatbot: "le chatbot",
  demo: "la démo du tableau de bord",
};

export interface LeadDeps {
  crm: Pick<CrmService, "ingestLead">;
  prisma: PrismaClient;
  notifier: ConsultantNotifier;
  env: { TURNSTILE_SECRET_KEY: string; ADMIN_NOTIFICATION_EMAIL: string; APP_URL: string };
  /** Injected in tests. */
  verifyHuman?: typeof verifyTurnstile;
  rateLimit?: typeof consume;
}

const logger = createLogger({ service: "web" });

const json = (status: number, body: Record<string, unknown>, headers?: HeadersInit) =>
  Response.json(body, { status, headers });

/** Public answers are deliberately generic: they never reveal whether a contact already exists. */
const GENERIC_INVALID = { ok: false, error: "Les informations saisies sont invalides." };

/**
 * `POST /api/leads` (spec, 5 and 6.1): rate limit, honeypot, Turnstile, strict
 * validation, then dedup-aware ingestion, consultant notification and follow-ups.
 */
export async function handleLeadRequest(request: Request, deps: LeadDeps): Promise<Response> {
  const ip = clientIp(request.headers);
  const verifyHuman = deps.verifyHuman ?? verifyTurnstile;
  const rateLimit = deps.rateLimit ?? consume;

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json(415, { ok: false, error: "Format non supporté." });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: "Requête trop volumineuse." });

  // Rate limit first, so malformed and spam attempts count too (5 per hour per IP).
  try {
    await rateLimit(LIMITS.leadIp, ip);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return json(
        429,
        { ok: false, error: "Trop de demandes. Réessayez plus tard." },
        { "Retry-After": String(error.retryAfterSeconds) },
      );
    }
    throw error;
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, error: "Requête trop volumineuse." });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, GENERIC_INVALID);
  }

  // Honeypot: bots fill every field. Answer as if it worked, store nothing.
  const honeypot = (raw as { website?: unknown } | null)?.website;
  if (typeof honeypot === "string" && honeypot.trim() !== "") return json(200, { ok: true });

  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) return json(400, GENERIC_INVALID);
  const { turnstileToken, website: _website, consent: _consent, source, ...fields } = parsed.data;

  const human = await verifyHuman({
    secret: deps.env.TURNSTILE_SECRET_KEY,
    token: turnstileToken,
    ip,
  });
  if (!human) {
    return json(400, { ok: false, error: "Vérification anti-spam échouée. Rechargez la page et réessayez." });
  }

  try {
    const result = await deps.crm.ingestLead({
      ...fields,
      source,
      sourceLabel: SOURCE_LABELS[source],
    });
    logger.info({ source, created: result.created }, "lead received");
    await notifyConsultant(deps, result, SOURCE_LABELS[source]);
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof CrmError) return json(400, GENERIC_INVALID);
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "lead ingestion failed");
    return json(500, { ok: false, error: "Une erreur est survenue. Réessayez plus tard." });
  }
}

/** Best effort: a notification failure must never lose the lead. */
async function notifyConsultant(
  deps: LeadDeps,
  lead: { prospectId: string; created: boolean; companyName: string; contactName: string },
  sourceLabel: string,
) {
  try {
    const admins = await deps.prisma.user.findMany({
      where: { role: "ADMIN", disabledAt: null },
      select: { id: true },
    });
    if (admins.length > 0) {
      await deps.prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          type: "NEW_LEAD",
          payload: { prospectId: lead.prospectId, returning: !lead.created },
        })),
      });
    }
    await deps.notifier.notifyNewLead({
      to: deps.env.ADMIN_NOTIFICATION_EMAIL,
      prospectId: lead.prospectId,
      returning: !lead.created,
      sourceLabel,
      companyName: lead.companyName,
      contactName: lead.contactName,
      appUrl: deps.env.APP_URL,
    });
  } catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "lead notification failed");
  }
}
