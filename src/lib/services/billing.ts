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
    return inv;
  });

export const invoiceTotals = (inv: Pick<Invoice, "lines" | "vatRate">) => {
  const ht = inv.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const vat = Math.round(ht * inv.vatRate);
  return { ht, vat, ttc: ht + vat };
};
