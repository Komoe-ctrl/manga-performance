import { formatFcfa } from "@manga/core";
import type { PrismaClient } from "@manga/db";
import { createSettingsRepository } from "../repositories/settings";

/** Everything needed to print an invoice, loaded in one place. */
export interface InvoiceDocumentData {
  id: string;
  number: string | null;
  status: string;
  isCreditNote: boolean;
  /** Number of the invoice a credit note cancels. */
  creditNoteOfNumber: string | null;
  fneNumber: string | null;
  vatRateBp: number;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  amountPaid: number;
  issuedAt: Date | null;
  dueAt: Date | null;
  createdAt: Date;
  lines: { position: number; label: string; quantity: number; unitPrice: number; total: number }[];
  client: { legalName: string; address: string | null; taxId: string | null; contactName: string | null; email: string | null; phone: string | null; city: string | null };
  cabinet: { name: string; address: string; phone: string; email: string; bankDetails: string; invoiceMentions: string };
}

/** `clientId` restricts the lookup to one client (client-space downloads). */
export async function loadInvoiceDocument(
  prisma: PrismaClient,
  id: string,
  scope?: { clientId: string; excludeDrafts: true },
): Promise<InvoiceDocumentData | null> {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id,
      ...(scope ? { clientId: scope.clientId, status: { not: "BROUILLON" } } : {}),
    },
    include: { lines: { orderBy: { position: "asc" } }, client: { include: { prospect: true } } },
  });
  if (!invoice) return null;

  const original = invoice.creditNoteOfId
    ? await prisma.invoice.findUnique({ where: { id: invoice.creditNoteOfId }, select: { number: true } })
    : null;
  const settings = await createSettingsRepository(prisma).get();

  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    isCreditNote: invoice.creditNoteOfId !== null,
    creditNoteOfNumber: original?.number ?? null,
    fneNumber: invoice.fneNumber,
    vatRateBp: invoice.vatRate,
    totalHt: invoice.totalHt,
    totalVat: invoice.totalVat,
    totalTtc: invoice.totalTtc,
    amountPaid: invoice.amountPaid,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    createdAt: invoice.createdAt,
    lines: invoice.lines,
    client: {
      legalName: invoice.client.legalName,
      address: invoice.client.address,
      taxId: invoice.client.taxId,
      contactName: invoice.client.prospect.contactName,
      email: invoice.client.prospect.email,
      phone: invoice.client.prospect.phone,
      city: invoice.client.prospect.city,
    },
    cabinet: {
      name: settings.cabinetName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      bankDetails: settings.bankDetails,
      invoiceMentions: settings.invoiceMentions,
    },
  };
}

/** Wording shown on every PDF: it is a management document, never a normalised invoice. */
export const NOT_NORMALISED_NOTICE =
  "Document de gestion : il ne constitue pas une facture normalisée. La facture normalisée électronique (FNE) est émise séparément sur la plateforme de la DGI.";

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Africa/Abidjan" });
const formatDate = (date: Date | null) => (date ? dateFormat.format(date) : "—");
const formatQuantity = (hundredths: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(hundredths / 100);

export interface InvoiceView {
  title: "FACTURE" | "AVOIR";
  /** Printed in large letters across the page when the document is not a valid invoice. */
  watermark: "BROUILLON" | "ANNULÉE" | null;
  number: string;
  fneLine: string | null;
  creditNoteLine: string | null;
  meta: { label: string; value: string }[];
  cabinet: InvoiceDocumentData["cabinet"];
  client: { name: string; lines: string[] };
  rows: { label: string; quantity: string; unitPrice: string; total: string }[];
  totals: { label: string; value: string; strong?: boolean }[];
  paymentLines: string[];
  notice: string;
}

/** Pure view-model of the PDF: all wording and number formatting, testable without rendering. */
export function buildInvoiceView(data: InvoiceDocumentData): InvoiceView {
  const vatPercent = data.vatRateBp / 100;
  const due = Math.max(0, data.totalTtc - data.amountPaid);

  const totals: InvoiceView["totals"] = [
    { label: "Total HT", value: formatFcfa(data.totalHt) },
    { label: `TVA (${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(vatPercent)} %)`, value: formatFcfa(data.totalVat) },
    { label: "Total TTC", value: formatFcfa(data.totalTtc), strong: true },
  ];
  if (!data.isCreditNote && data.amountPaid > 0) {
    totals.push({ label: "Déjà réglé", value: formatFcfa(data.amountPaid) }, { label: "Reste à payer", value: formatFcfa(due), strong: true });
  }

  return {
    title: data.isCreditNote ? "AVOIR" : "FACTURE",
    watermark: data.status === "BROUILLON" ? "BROUILLON" : data.status === "ANNULEE" ? "ANNULÉE" : null,
    number: data.number ?? "Brouillon (non numérotée)",
    // The FNE number is shown when it was recorded, next to the reminder that this is not the FNE itself.
    fneLine: data.fneNumber ? `N° FNE : ${data.fneNumber}` : null,
    creditNoteLine: data.isCreditNote ? `Annule la facture n° ${data.creditNoteOfNumber ?? "—"}` : null,
    meta: [
      { label: "Date d'émission", value: formatDate(data.issuedAt) },
      ...(data.isCreditNote ? [] : [{ label: "Échéance", value: formatDate(data.dueAt) }]),
    ],
    cabinet: data.cabinet,
    client: {
      name: data.client.legalName,
      lines: [
        data.client.address,
        data.client.city,
        data.client.taxId ? `NCC : ${data.client.taxId}` : null,
        data.client.contactName ? `À l'attention de ${data.client.contactName}` : null,
      ].filter((line): line is string => Boolean(line)),
    },
    rows: data.lines.map((line) => ({
      label: line.label,
      quantity: formatQuantity(line.quantity),
      unitPrice: formatFcfa(line.unitPrice),
      total: formatFcfa(line.total),
    })),
    totals,
    paymentLines: data.isCreditNote ? [] : [data.cabinet.bankDetails, data.cabinet.invoiceMentions].filter((line) => line.trim() !== ""),
    notice: NOT_NORMALISED_NOTICE,
  };
}
