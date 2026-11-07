import { createLogger } from "@manga/core";
import { leadSchema, type LeadSource } from "@manga/validation";
import { LIMITS, type consume } from "../auth/rate-limit";
import { CrmError } from "../crm/errors";
import type { CrmService } from "../crm/crm-service";
import type { ConsultantNotifier } from "../email/consultant-notifier";
import { GENERIC_INVALID, isHoneypotFilled, json, readPublicJson } from "../security/public-form";
import { verifyTurnstile } from "../security/turnstile";

const SOURCE_LABELS: Record<LeadSource, string> = {
  site_formulaire: "le formulaire de contact",
  chatbot: "le chatbot",
  demo: "la démo du tableau de bord",
};

export interface LeadDeps {
  crm: Pick<CrmService, "ingestLead">;
  notifier: ConsultantNotifier;
  env: { TURNSTILE_SECRET_KEY: string; ADMIN_NOTIFICATION_EMAIL: string; APP_URL: string };
  /** Injected in tests. */
  verifyHuman?: typeof verifyTurnstile;
  rateLimit?: typeof consume;
}

const logger = createLogger({ service: "web" });

/**
 * `POST /api/leads` (spec, 5 and 6.1): rate limit, honeypot, Turnstile, strict
 * validation, then dedup-aware ingestion, consultant notification and follow-ups.
 */
export async function handleLeadRequest(request: Request, deps: LeadDeps): Promise<Response> {
  const verifyHuman = deps.verifyHuman ?? verifyTurnstile;
  const input = await readPublicJson(request, { limit: LIMITS.leadIp, rateLimit: deps.rateLimit });
  if (!input.ok) return input.response;
  const { ip, raw } = input;

  // Honeypot: bots fill every field. Answer as if it worked, store nothing.
  if (isHoneypotFilled(raw)) return json(200, { ok: true });

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
    // Queued: the worker creates the in-app notifications and sends the email, with retries.
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
