/**
 * A business-rule failure with a French message that is safe to show to the admin.
 * Server actions turn it into a `{ ok: false, code, error }` result.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
