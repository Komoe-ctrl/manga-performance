import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Self-contained signed tokens (HMAC-SHA256), for links that must work without a
 * session: unsubscribe links and email tracking (spec, 6.6 and 6.7).
 *
 * `purpose` is part of what is signed, so a token made for one use is worthless for another
 * (an open-tracking id cannot be replayed as an unsubscribe link).
 */
export function signToken(purpose: string, payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(purpose, body, secret)}`;
}

/** Returns the payload of a genuine token for `purpose`, or `null` (forged, altered, expired, malformed). */
export function verifyToken<T extends Record<string, unknown>>(
  purpose: string,
  token: string,
  secret: string,
  now: Date = new Date(),
): T | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts as [string, string];

  const expected = Buffer.from(mac(purpose, body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof payload.exp === "number" && payload.exp * 1000 < now.getTime()) return null;
    return payload;
  } catch {
    return null;
  }
}

function mac(purpose: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${purpose}.${body}`).digest("base64url");
}

/** Constant-time check of a webhook secret or HMAC given as strings. */
export function safeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** Hex HMAC-SHA256 of a raw request body. */
export function hmacHex(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
