import { createLogger, verifyToken } from "@manga/core";
import { newsletterSubscribeSchema } from "@manga/validation";
import { LIMITS, RateLimitError, consume } from "../auth/rate-limit";
import { GENERIC_INVALID, isHoneypotFilled, json, readPublicJson } from "../security/public-form";
import { verifyTurnstile } from "../security/turnstile";
import type { NewsletterService } from "./newsletter-service";

const logger = createLogger({ service: "web" });

export interface SubscribeDeps {
  newsletter: Pick<NewsletterService, "subscribe">;
  env: { TURNSTILE_SECRET_KEY: string };
  verifyHuman?: typeof verifyTurnstile;
  rateLimit?: typeof consume;
}

/**
 * `POST /api/newsletter/subscribe`: same protections as every public form (rate limit,
 * honeypot, Turnstile, strict validation) and the same answer whatever happens inside.
 */
export async function handleSubscribe(request: Request, deps: SubscribeDeps): Promise<Response> {
  const rateLimit = deps.rateLimit ?? consume;
  const input = await readPublicJson(request, { limit: LIMITS.newsletterIp, rateLimit });
  if (!input.ok) return input.response;
  if (isHoneypotFilled(input.raw)) return json(200, { ok: true });

  const parsed = newsletterSubscribeSchema.safeParse(input.raw);
  if (!parsed.success) return json(400, GENERIC_INVALID);

  const human = await (deps.verifyHuman ?? verifyTurnstile)({ secret: deps.env.TURNSTILE_SECRET_KEY, token: parsed.data.turnstileToken, ip: input.ip });
  if (!human) return json(400, { ok: false, error: "Vérification anti-spam échouée. Rechargez la page et réessayez." });

  try {
    await rateLimit(LIMITS.newsletterEmail, parsed.data.email);
  } catch (error) {
    // Too many requests for this address: look successful, send nothing.
    if (error instanceof RateLimitError) return json(200, { ok: true });
    throw error;
  }

  try {
    await deps.newsletter.subscribe({ email: parsed.data.email, ip: input.ip });
    return json(200, { ok: true });
  } catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "newsletter subscription failed");
    return json(500, { ok: false, error: "Une erreur est survenue. Réessayez plus tard." });
  }
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Minimal, script-free page for the unsubscribe flow (it must work from any mail client). */
function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{font-family:Helvetica,Arial,sans-serif;background:#f1f5f9;color:#1e293b;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fff;max-width:440px;margin:24px;padding:32px;border-radius:12px;border-top:4px solid #f5b700}h1{color:#1a2b4a;font-size:20px;margin:0 0 12px}button{background:#f5b700;color:#1a2b4a;border:0;border-radius:999px;padding:12px 24px;font-weight:700;font-size:15px;cursor:pointer}p{line-height:1.5}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export interface UnsubscribeDeps {
  newsletter: Pick<NewsletterService, "unsubscribe">;
  secret: string;
}

/**
 * `GET|POST /api/newsletter/unsubscribe?token=…` (spec, 6.6). The link is signed and works
 * without signing in. GET only shows a button: mail scanners and link previewers open links,
 * and must not unsubscribe people. POST (the button, or a mail client's RFC 8058 one-click
 * request) does it.
 */
export async function handleUnsubscribe(request: Request, deps: UnsubscribeDeps): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const payload = verifyToken<{ email?: string }>("unsub", token, deps.secret);
  if (!payload?.email) return page("Lien invalide", "<p>Ce lien de désinscription est invalide ou incomplet.</p>", 400);

  if (request.method === "POST") {
    await deps.newsletter.unsubscribe(payload.email);
    return page("Vous êtes désinscrit", "<p>Vous ne recevrez plus d'emails de notre part. Cela peut prendre quelques minutes.</p>");
  }
  return page(
    "Se désinscrire ?",
    `<p>Confirmez-vous ne plus vouloir recevoir nos emails ?</p><form method="post" action="${escapeHtml(url.pathname + url.search)}"><button type="submit">Me désinscrire</button></form>`,
  );
}
