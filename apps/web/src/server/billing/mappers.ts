import type { InvoiceStatus as DbInvoiceStatus } from "@manga/db";
import type { Invoice, InvoiceStatus } from "@/lib/types";

/**
 * Database status -> front status. The front has no "partially paid" and uses
 * "en_attente" for an issued invoice that is waiting to be paid.
 */
export function toFrontInvoiceStatus(status: DbInvoiceStatus): InvoiceStatus {
  switch (status) {
    case "BROUILLON":
      return "brouillon";
    case "EMISE":
    case "PARTIELLEMENT_PAYEE":
      return "en_attente";
    case "EN_RETARD":
      return "en_retard";
    case "PAYEE":
      return "payee";
    case "ANNULEE":
      return "annulee";
  }
}

interface InvoiceRow {
  id: string;
  number: string | null;
  fneNumber: string | null;
  vatRate: number;
  status: DbInvoiceStatus;
  issuedAt: Date | null;
  dueAt: Date | null;
  createdAt: Date;
  remindersSent: number;
  client: { prospectId: string };
  lines: { label: string; quantity: number; unitPrice: number }[];
}

/**
 * The front works with the prospect id as client id, fractions for the VAT rate and
 * decimal quantities; the database stores basis points and hundredths.
 */
export function toFrontInvoice(row: InvoiceRow): Invoice {
  const issuedAt = (row.issuedAt ?? row.createdAt).toISOString();
  return {
    id: row.id,
    number: row.number ?? "Brouillon",
    fneNumber: row.fneNumber ?? undefined,
    clientId: row.client.prospectId,
    lines: row.lines.map((line) => ({
      label: line.label,
      quantity: line.quantity / 100,
      unitPrice: line.unitPrice,
    })),
    vatRate: row.vatRate / 10_000,
    issuedAt,
    dueAt: (row.dueAt ?? row.issuedAt ?? row.createdAt).toISOString(),
    status: toFrontInvoiceStatus(row.status),
    remindersSent: row.remindersSent,
  };
}

/** Audit log action -> label shown in the invoice history. */
export function auditLabel(action: string, diff: unknown): string {
  const d = (diff ?? {}) as Record<string, unknown>;
  switch (action) {
    case "invoice.draft_created":
      return "Facture créée (brouillon)";
    case "invoice.draft_updated":
      return "Brouillon modifié";
    case "invoice.issued":
      return `Facture émise (n° ${String(d.number ?? "")})`.replace(" (n° )", "");
    case "invoice.payment_recorded":
      return `Paiement de ${new Intl.NumberFormat("fr-FR").format(Number(d.amount ?? 0)).replace(/[  ]/g, " ")} FCFA enregistré`;
    case "invoice.overdue":
      return "Échéance dépassée";
    case "invoice.reminder_sent":
      return `Relance n°${String(d.reminderNumber ?? "")} envoyée${d.manual ? " (manuelle)" : ""}`;
    case "invoice.fne_recorded":
      return d.fneNumber ? "N° FNE renseigné" : "N° FNE retiré";
    case "invoice.cancelled":
      return `Annulée par l'avoir ${String(d.creditNote ?? "")}`.trim();
    default:
      return action;
  }
}
