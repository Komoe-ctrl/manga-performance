import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Authentication of the internal API used by the scraper (spec, 6.10): a shared token
 * header AND an HMAC of the request with a timestamp (5 minute window) and a nonce
 * (anti-replay). The Python service implements the same scheme; both are tested against
 * `apps/scraper/tests/fixtures/signing-vectors.json`.
 *
 * Signed string: `{timestamp}.{nonce}.{METHOD}.{path?query}.{sha256 hex of the body}`.
 */
export const INTERNAL_TOLERANCE_SECONDS = 300;

export interface SignParts {
  timestamp: number;
  nonce: string;
  method: string;
  /** Path and query string, exactly as sent (e.g. `/api/internal/scrape-jobs/next`). */
  path: string;
  body: string;
}

export function bodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function signInternalRequest(parts: SignParts, secret: string): string {
  const message = [parts.timestamp, parts.nonce, parts.method.toUpperCase(), parts.path, bodyHash(parts.body)].join(".");
  return createHmac("sha256", secret).update(message).digest("hex");
}

export type InternalSignatureCheck = { ok: true } | { ok: false; reason: "STALE" | "BAD_SIGNATURE" | "MALFORMED" };

/** Checks the signature and the clock window. Replay detection is the caller's job (it needs storage). */
export function verifyInternalSignature(
  parts: Omit<SignParts, "timestamp"> & { timestamp: string | null; signature: string | null },
  secret: string,
  now: Date = new Date(),
): InternalSignatureCheck {
  const timestamp = Number(parts.timestamp);
  if (!parts.timestamp || !Number.isInteger(timestamp) || !parts.signature || !/^[0-9a-f]{64}$/.test(parts.signature)) {
    return { ok: false, reason: "MALFORMED" };
  }
  if (!parts.nonce || parts.nonce.length < 8 || parts.nonce.length > 128) return { ok: false, reason: "MALFORMED" };
  if (Math.abs(now.getTime() / 1000 - timestamp) > INTERNAL_TOLERANCE_SECONDS) return { ok: false, reason: "STALE" };

  const expected = Buffer.from(signInternalRequest({ ...parts, timestamp }, secret));
  const given = Buffer.from(parts.signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: "BAD_SIGNATURE" };
}
