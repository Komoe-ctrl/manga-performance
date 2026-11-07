const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileOptions {
  secret: string;
  token: string | undefined;
  ip?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Verifies a Cloudflare Turnstile token server-side. Fails closed: a missing token,
 * a network error, a timeout or any non-success answer all mean "not human".
 */
export async function verifyTurnstile({
  secret,
  token,
  ip,
  fetchImpl = fetch,
}: TurnstileOptions): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
