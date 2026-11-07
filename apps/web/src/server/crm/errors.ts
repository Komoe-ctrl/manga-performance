import { DomainError } from "../domain-error";

export type CrmErrorCode =
  | "NOT_FOUND"
  | "DUPLICATE"
  | "INVALID"
  | "NO_EMAIL"
  | "CLIENT_LOCKED"
  | "NOT_A_CLIENT";

/** Business-rule failure of the CRM. */
export class CrmError extends DomainError {
  declare readonly code: CrmErrorCode;
  declare readonly details?: { existingId?: string };

  constructor(code: CrmErrorCode, message: string, details?: { existingId?: string }) {
    super(code, message, details);
    this.name = "CrmError";
  }
}
