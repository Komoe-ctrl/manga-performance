/**
 * `DATA_SOURCE=mock|db` (spec, section 0). The value is inlined at build time through
 * `next.config.ts` so client components can read it; mocks stay available for comparison.
 */
export const USE_DB = process.env.NEXT_PUBLIC_DATA_SOURCE === "db";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

/** Error raised by a failed server action, carrying the stable error code. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Server actions return results (their thrown messages are scrubbed in production). */
export async function unwrap<T>(pending: Promise<ActionResult<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) throw new ServiceError(result.error, result.code);
  return result.data;
}
