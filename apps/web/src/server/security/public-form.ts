import { RateLimitError, clientIp, consume, type LimitRule } from "../auth/rate-limit";

const MAX_BODY_BYTES = 20_000;

export const json = (status: number, body: Record<string, unknown>, headers?: HeadersInit) =>
  Response.json(body, { status, headers });

/** Public answers are deliberately generic: they never reveal what exists on the server. */
export const GENERIC_INVALID = { ok: false, error: "Les informations saisies sont invalides." };

export type PublicJson = { ok: true; ip: string; raw: unknown } | { ok: false; response: Response };

/**
 * Common start of every public form endpoint (spec, section 5): JSON only, size cap, then
 * the per-IP rate limit (before parsing, so malformed and spam attempts count too).
 */
export async function readPublicJson(
  request: Request,
  options: { limit: LimitRule; rateLimit?: typeof consume },
): Promise<PublicJson> {
  const ip = clientIp(request.headers);
  const rateLimit = options.rateLimit ?? consume;

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return { ok: false, response: json(415, { ok: false, error: "Format non supporté." }) };
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { ok: false, response: json(413, { ok: false, error: "Requête trop volumineuse." }) };
  }

  try {
    await rateLimit(options.limit, ip);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return {
        ok: false,
        response: json(429, { ok: false, error: "Trop de demandes. Réessayez plus tard." }, { "Retry-After": String(error.retryAfterSeconds) }),
      };
    }
    throw error;
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: json(413, { ok: false, error: "Requête trop volumineuse." }) };
  }
  try {
    return { ok: true, ip, raw: JSON.parse(text) };
  } catch {
    return { ok: false, response: json(400, GENERIC_INVALID) };
  }
}

/** Bots fill every field: a filled honeypot gets a fake success and nothing is stored. */
export function isHoneypotFilled(raw: unknown): boolean {
  const value = (raw as { website?: unknown } | null)?.website;
  return typeof value === "string" && value.trim() !== "";
}
