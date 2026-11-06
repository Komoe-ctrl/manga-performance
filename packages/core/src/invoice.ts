/**
 * Invoice arithmetic (spec, 6.4). Everything is an integer: FCFA has no subdivision,
 * quantities are in hundredths (150 = 1.5 day) and VAT is in basis points (1800 = 18 %).
 */

/** PostgreSQL `integer` ceiling: amounts must fit the database column. */
export const MAX_AMOUNT = 2_000_000_000;

/**
 * Integer division rounded half away from zero, exact for integers (no float error).
 * Symmetric on purpose: the credit note of a line is exactly the opposite of the line.
 */
export function divRound(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new RangeError("divRound expects integers and a positive denominator");
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  // `|| 0` turns a negative zero into 0 (e.g. -49 / 100).
  return sign * Math.floor((2 * abs + denominator) / (2 * denominator)) || 0;
}

export interface InvoiceLineInput {
  label: string;
  /** In hundredths: 100 = 1, 150 = 1.5. */
  quantity: number;
  /** FCFA excluding VAT. */
  unitPrice: number;
}

export interface ComputedLine extends InvoiceLineInput {
  position: number;
  /** FCFA excluding VAT: round(quantity × unitPrice / 100). */
  total: number;
}

export interface InvoiceTotals {
  lines: ComputedLine[];
  totalHt: number;
  totalVat: number;
  totalTtc: number;
}

export class InvoiceCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceCalculationError";
  }
}

export function lineTotal(quantity: number, unitPrice: number): number {
  return divRound(quantity * unitPrice, 100);
}

/**
 * Totals of an invoice: line totals rounded one by one, VAT rounded once on the
 * invoice total (spec: "TVA arrondie à l'unité, au niveau de la facture").
 * The server always recomputes this; totals sent by a browser are never trusted.
 */
export function computeInvoiceTotals(lines: InvoiceLineInput[], vatRateBp: number): InvoiceTotals {
  if (!Number.isInteger(vatRateBp) || vatRateBp < 0 || vatRateBp > 10_000) {
    throw new InvoiceCalculationError("Taux de TVA invalide.");
  }
  const computed = lines.map((line, index): ComputedLine => {
    if (!Number.isInteger(line.quantity) || !Number.isInteger(line.unitPrice)) {
      throw new InvoiceCalculationError("Quantités et prix doivent être des nombres entiers.");
    }
    if (Math.abs(line.quantity) > MAX_AMOUNT || Math.abs(line.unitPrice) > MAX_AMOUNT) {
      throw new InvoiceCalculationError("Montant trop élevé.");
    }
    return { ...line, position: index + 1, total: lineTotal(line.quantity, line.unitPrice) };
  });

  const totalHt = computed.reduce((sum, line) => sum + line.total, 0);
  const totalVat = divRound(totalHt * vatRateBp, 10_000);
  const totalTtc = totalHt + totalVat;
  if (Math.abs(totalTtc) > MAX_AMOUNT) throw new InvoiceCalculationError("Montant trop élevé.");
  return { lines: computed, totalHt, totalVat, totalTtc };
}

/** Lines of the credit note that cancels an invoice: same labels and quantities, opposite prices. */
export function negateLines(lines: InvoiceLineInput[]): InvoiceLineInput[] {
  return lines.map((line) => ({ ...line, unitPrice: -line.unitPrice }));
}

export type InvoiceStatusValue =
  | "BROUILLON"
  | "EMISE"
  | "PAYEE"
  | "PARTIELLEMENT_PAYEE"
  | "EN_RETARD"
  | "ANNULEE";

export const amountDue = (invoice: { totalTtc: number; amountPaid: number }): number =>
  Math.max(0, invoice.totalTtc - invoice.amountPaid);

/**
 * Status of an issued invoice, from its payments and due date. PAYEE once the amount
 * paid reaches the total; otherwise EN_RETARD after the due date, PARTIELLEMENT_PAYEE
 * when something was paid, EMISE when nothing was. Drafts and cancelled invoices never move.
 */
export function computeInvoiceStatus(
  invoice: {
    status: InvoiceStatusValue;
    totalTtc: number;
    amountPaid: number;
    dueAt: Date | null;
  },
  now: Date,
): InvoiceStatusValue {
  if (invoice.status === "BROUILLON" || invoice.status === "ANNULEE") return invoice.status;
  if (invoice.amountPaid >= invoice.totalTtc) return "PAYEE";
  if (invoice.dueAt && invoice.dueAt.getTime() < now.getTime()) return "EN_RETARD";
  return invoice.amountPaid > 0 ? "PARTIELLEMENT_PAYEE" : "EMISE";
}

/** `AAAA-NNN` (the sequence grows past 3 digits when needed). */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `${year}-${String(sequence).padStart(3, "0")}`;
}

export function parseInvoiceNumber(value: string): { year: number; sequence: number } | null {
  const match = /^(\d{4})-(\d{3,})$/.exec(value);
  return match ? { year: Number(match[1]), sequence: Number(match[2]) } : null;
}

/** Calendar year of a date in the display timezone (numbering restarts on 1 January, Abidjan time). */
export function invoiceYear(date: Date, timeZone = "Africa/Abidjan"): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(date));
}

/** Unpaid-invoice reminders: 3, 10 and 20 days after the due date, at most 3 (spec, 6.4). */
export const REMINDER_OFFSETS_DAYS = [3, 10, 20] as const;
export const MAX_REMINDERS = REMINDER_OFFSETS_DAYS.length;

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when the next automatic reminder (the `remindersSent + 1`-th) is due. */
export function isReminderDue(dueAt: Date, remindersSent: number, now: Date): boolean {
  const offset = REMINDER_OFFSETS_DAYS[remindersSent];
  if (offset === undefined) return false;
  return now.getTime() >= dueAt.getTime() + offset * DAY_MS;
}

/** FCFA for display: `1 250 000 FCFA` (no decimals, plain spaces). */
export function formatFcfa(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount).replace(/[  ]/g, " ")} FCFA`;
}
