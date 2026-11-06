export type CrmErrorCode =
  | "NOT_FOUND"
  | "DUPLICATE"
  | "INVALID"
  | "NO_EMAIL"
  | "CLIENT_LOCKED"
  | "NOT_A_CLIENT";

/** Business-rule failure with a French message that is safe to show to the admin. */
export class CrmError extends Error {
  constructor(
    public readonly code: CrmErrorCode,
    message: string,
    public readonly details?: { existingId?: string },
  ) {
    super(message);
    this.name = "CrmError";
  }
}
