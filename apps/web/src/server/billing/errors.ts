import { DomainError } from "../domain-error";

export type BillingErrorCode =
  | "NOT_FOUND"
  | "CLIENT_NOT_FOUND"
  | "INVALID"
  | "NOT_A_DRAFT"
  | "NOT_ISSUED"
  | "EMPTY_INVOICE"
  | "ALREADY_CANCELLED"
  | "CREDIT_NOTE"
  | "HAS_PAYMENTS"
  | "OVERPAYMENT"
  | "REMINDER_REFUSED";

/** Business-rule failure of the billing module. */
export class BillingError extends DomainError {
  declare readonly code: BillingErrorCode;

  constructor(code: BillingErrorCode, message: string) {
    super(code, message);
    this.name = "BillingError";
  }
}
