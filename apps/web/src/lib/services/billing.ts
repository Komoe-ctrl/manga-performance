import { computeInvoiceTotals } from "@manga/core/invoice";
import { REFERENCE_DATE } from "@/lib/constants";
import { invoiceNumber } from "@/lib/mock/business";
import type { Invoice } from "@/lib/types";
import * as billing from "@/server/actions/billing";
import { USE_DB, unwrap } from "./data-source";
import { db, latency, nextId } from "./store";

export const listInvoices = (): Promise<Invoice[]> =>
  USE_DB ? unwrap(billing.listInvoicesAction()) : latency(() => [...db.invoices]);

export const getInvoice = (id: string): Promise<Invoice | null> =>
  USE_DB
    ? unwrap(billing.getInvoiceAction(id))
    : latency(() => db.invoices.find((i) => i.id === id) ?? null);

/**
 * `DATA_SOURCE=db`: creates a draft, and issues it right away when `status` is `emise`.
 * The number, totals and issue date are decided by the server (the issue date is the
 * moment of emission, whatever date the form shows).
 */
/** Prochain numéro de la démo : AAAA de l'année en cours, suite après le plus grand numéro déjà attribué. */
function nextMockInvoiceNumber(): string {
  const year = new Date(REFERENCE_DATE).getUTCFullYear();
  const used = db.invoices.map((i) => i.number).filter((n): n is string => !!n && n.startsWith(`${year}-`)).map((n) => Number(n.slice(5)));
  return invoiceNumber(year, Math.max(0, ...used) + 1);
}

export const createInvoice = (input: Omit<Invoice, "id" | "number" | "remindersSent">): Promise<Invoice> =>
  USE_DB
    ? unwrap(billing.createInvoiceAction(input))
    : latency(() => {
        // Only an issued invoice is numbered; a draft stays without number until its emission.
        const invoice: Invoice = { ...input, id: nextId("inv"), number: input.status === "brouillon" ? undefined : nextMockInvoiceNumber(), remindersSent: 0 };
        db.invoices.unshift(invoice);
        return invoice;
      });

export const remindInvoice = (id: string): Promise<Invoice> =>
  USE_DB
    ? unwrap(billing.remindInvoiceAction(id))
    : latency(() => {
        const inv = db.invoices.find((i) => i.id === id);
        if (!inv) throw new Error("Facture introuvable");
        inv.remindersSent += 1;
        (db.invoiceEvents[id] ??= []).push({ label: `Relance n°${inv.remindersSent} envoyée`, at: new Date().toISOString() });
        return inv;
      });

/**
 * Same arithmetic as the server (integers, VAT rounded once on the total), so the preview
 * in the form always matches what gets issued. Quantities may be decimal here.
 */
export const invoiceTotals = (inv: Pick<Invoice, "lines" | "vatRate">) => {
  try {
    const totals = computeInvoiceTotals(
      inv.lines.map((line) => ({ label: "", quantity: Math.round(line.quantity * 100), unitPrice: Math.round(line.unitPrice) })),
      Math.round(inv.vatRate * 10_000),
    );
    return { ht: totals.totalHt, vat: totals.totalVat, ttc: totals.totalTtc };
  } catch {
    // Half-typed or absurd values while the form is being filled in.
    return { ht: 0, vat: 0, ttc: 0 };
  }
};

export interface InvoiceEvent {
  label: string;
  at: string;
}

/** Historique des statuts : événements enregistrés + jalons déduits des dates de la facture. */
export const getInvoiceDetail = (id: string) =>
  USE_DB
    ? unwrap(billing.getInvoiceDetailAction(id))
    : latency(() => {
        const invoice = db.invoices.find((i) => i.id === id);
        if (!invoice) return null;
        const client = db.prospects.find((p) => p.id === invoice.clientId) ?? null;
        const events: InvoiceEvent[] = [{ label: "Facture créée (brouillon)", at: invoice.issuedAt }];
        if (invoice.status !== "brouillon") events.push({ label: "Facture émise", at: invoice.issuedAt });
        if (invoice.status === "en_retard") events.push({ label: "Échéance dépassée", at: invoice.dueAt });
        events.push(...(db.invoiceEvents[id] ?? []));
        return { invoice, client, events };
      });

/** `DATA_SOURCE=db`: only the FNE number and "mark as paid" (records the remaining amount). */
export const updateInvoice = (
  id: string,
  patch: Partial<Pick<Invoice, "fneNumber" | "status">>,
  eventLabel: string,
): Promise<Invoice> =>
  USE_DB
    ? unwrap(
        billing.updateInvoiceAction(id, {
          // An emptied field clears the number.
          ...("fneNumber" in patch ? { fneNumber: patch.fneNumber ?? "" } : {}),
          ...(patch.status ? { status: patch.status } : {}),
        }),
      )
    : latency(() => {
        const inv = db.invoices.find((i) => i.id === id);
        if (!inv) throw new Error("Facture introuvable");
        Object.assign(inv, patch);
        // Issuing a draft is what numbers it.
        if (!inv.number && inv.status !== "brouillon") inv.number = nextMockInvoiceNumber();
        (db.invoiceEvents[id] ??= []).push({ label: eventLabel, at: new Date().toISOString() });
        return inv;
      });

export const nextInvoiceNumber = (): Promise<string> =>
  USE_DB
    ? unwrap(billing.nextInvoiceNumberAction())
    : latency(() => nextMockInvoiceNumber());

// Ready for the invoice screens (no UI calls them yet): emission, payments, credit notes.
export const issueInvoice = (id: string) => unwrap(billing.issueInvoiceAction(id));
export const recordPayment = (input: { id: string; amount: number; method: "VIREMENT" | "CHEQUE" | "ESPECES" | "MOBILE_MONEY" | "AUTRE"; paidAt: string; reference?: string }) =>
  unwrap(billing.recordPaymentAction(input));
export const cancelInvoice = (id: string, reason: string) => unwrap(billing.cancelInvoiceAction({ id, reason }));
export const deleteDraftInvoice = (id: string) => unwrap(billing.deleteDraftInvoiceAction(id));
export const duplicateInvoice = (id: string) => unwrap(billing.duplicateInvoiceAction(id));
export const setInvoiceReminders = (id: string, enabled: boolean) => unwrap(billing.setInvoiceRemindersAction(id, enabled));
