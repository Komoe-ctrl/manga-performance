import type { Invoice } from "@/lib/types";
import { db, latency, nextId } from "./store";

export const listInvoices = () => latency(() => [...db.invoices]);
export const getInvoice = (id: string) =>
  latency(() => db.invoices.find((i) => i.id === id) ?? null);

export const createInvoice = (input: Omit<Invoice, "id" | "number" | "remindersSent">) =>
  latency(() => {
    const number = `2026-${String(db.invoices.length + 1).padStart(3, "0")}`;
    const invoice: Invoice = { ...input, id: nextId("inv"), number, remindersSent: 0 };
    db.invoices.unshift(invoice);
    return invoice;
  });

export const remindInvoice = (id: string) =>
  latency(() => {
    const inv = db.invoices.find((i) => i.id === id);
    if (!inv) throw new Error("Facture introuvable");
    inv.remindersSent += 1;
    (db.invoiceEvents[id] ??= []).push({ label: `Relance n°${inv.remindersSent} envoyée`, at: new Date().toISOString() });
    return inv;
  });

export const invoiceTotals = (inv: Pick<Invoice, "lines" | "vatRate">) => {
  const ht = inv.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const vat = Math.round(ht * inv.vatRate);
  return { ht, vat, ttc: ht + vat };
};

export interface InvoiceEvent {
  label: string;
  at: string;
}

/** Historique des statuts : événements enregistrés + jalons déduits des dates de la facture. */
export const getInvoiceDetail = (id: string) =>
  latency(() => {
    const invoice = db.invoices.find((i) => i.id === id);
    if (!invoice) return null;
    const client = db.prospects.find((p) => p.id === invoice.clientId) ?? null;
    const events: InvoiceEvent[] = [{ label: "Facture créée (brouillon)", at: invoice.issuedAt }];
    if (invoice.status !== "brouillon") events.push({ label: "Facture émise", at: invoice.issuedAt });
    if (invoice.status === "en_retard") events.push({ label: "Échéance dépassée", at: invoice.dueAt });
    events.push(...(db.invoiceEvents[id] ?? []));
    return { invoice, client, events };
  });

export const updateInvoice = (
  id: string,
  patch: Partial<Pick<Invoice, "fneNumber" | "status">>,
  eventLabel: string,
) =>
  latency(() => {
    const inv = db.invoices.find((i) => i.id === id);
    if (!inv) throw new Error("Facture introuvable");
    Object.assign(inv, patch);
    (db.invoiceEvents[id] ??= []).push({ label: eventLabel, at: new Date().toISOString() });
    return inv;
  });

export const nextInvoiceNumber = () =>
  latency(() => `2026-${String(db.invoices.length + 1).padStart(3, "0")}`);
