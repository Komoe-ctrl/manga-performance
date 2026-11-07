import {
  InvoiceCalculationError,
  amountDue,
  computeInvoiceStatus,
  computeInvoiceTotals,
  formatInvoiceNumber,
  invoiceYear,
  negateLines,
  type InvoiceLineInput,
} from "@manga/core";
import { sendInvoiceReminder, type ReminderOutcome } from "@manga/db/billing-jobs";
import type { PaymentMethod, Prisma, PrismaClient } from "@manga/db";
import type { Enqueuer } from "../queue";
import { toFrontProspect } from "../crm/mappers";
import { recordAudit } from "../repositories/audit";
import { createSettingsRepository } from "../repositories/settings";
import type { Invoice } from "@/lib/types";
import { BillingError } from "./errors";
import { ManualFneProvider, type FneProvider } from "./fne";
import { auditLabel, toFrontInvoice } from "./mappers";

type Tx = Prisma.TransactionClient;

export interface BillingDeps {
  prisma: PrismaClient;
  queue: Pick<Enqueuer, "enqueueEmail">;
  appUrl: string;
  fne?: FneProvider;
  now?: () => Date;
}

export interface DraftInput {
  /** `Client.id` (not the prospect id). */
  clientId: string;
  /** Quantities in hundredths. */
  lines: InvoiceLineInput[];
  /** Basis points; defaults to the VAT rate of the settings. */
  vatRateBp?: number;
  dueAt?: Date | null;
}

export interface PaymentInput {
  amount: number;
  method: PaymentMethod;
  paidAt: Date;
  reference?: string;
}

const DEFAULT_DUE_DAYS = 30;
const MAX_LINES = 100;
const TX_OPTIONS = { timeout: 30_000, maxWait: 30_000 } as const;
const PAYABLE = ["EMISE", "PARTIELLEMENT_PAYEE", "EN_RETARD"];

const include = {
  lines: { orderBy: { position: "asc" } },
  client: { include: { prospect: true } },
} satisfies Prisma.InvoiceInclude;

const REMINDER_MESSAGES: Record<Exclude<ReminderOutcome, { sent: true }>["reason"], string> = {
  NOT_FOUND: "Facture introuvable.",
  NOT_REMINDABLE: "Cette facture ne peut pas être relancée.",
  DISABLED: "Les relances sont désactivées pour cette facture.",
  CAP_REACHED: "Le plafond de 3 relances est atteint.",
  NOT_DUE: "Aucune relance n'est due pour le moment.",
  NO_RECIPIENT: "Aucun email de contact n'est renseigné pour ce client.",
  RACE: "Une relance vient d'être envoyée.",
};

/**
 * Invoicing (spec, 6.4). Draft -> issued (numbered, totals recomputed, then immutable) ->
 * paid / overdue / cancelled by credit note. Callers must have checked authorization.
 */
export function createInvoiceService({ prisma, queue, appUrl, fne = new ManualFneProvider(), now = () => new Date() }: BillingDeps) {
  const settings = createSettingsRepository(prisma);

  const compute = (lines: InvoiceLineInput[], vatRateBp: number) => {
    if (lines.length > MAX_LINES) throw new BillingError("INVALID", `Une facture ne peut pas dépasser ${MAX_LINES} lignes.`);
    for (const line of lines) {
      if (!line.label.trim()) throw new BillingError("INVALID", "Chaque ligne doit avoir un libellé.");
    }
    try {
      return computeInvoiceTotals(lines, vatRateBp);
    } catch (error) {
      if (error instanceof InvoiceCalculationError) throw new BillingError("INVALID", error.message);
      throw error;
    }
  };

  const lock = (tx: Tx, id: string) => tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;

  /** Next number of the year. Row-locked until commit, so numbers are gapless and unique. */
  async function nextSequence(tx: Tx, year: number): Promise<number> {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "InvoiceCounter" ("year", "value") VALUES (${year}::int, 1)
      ON CONFLICT ("year") DO UPDATE SET "value" = "InvoiceCounter"."value" + 1
      RETURNING "value"`;
    return rows[0]!.value;
  }

  /** Emission, inside a transaction: recompute, number, freeze. */
  async function issueInTx(tx: Tx, id: string, actorId: string): Promise<string> {
    await lock(tx, id);
    const invoice = await tx.invoice.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!invoice) throw new BillingError("NOT_FOUND", "Facture introuvable.");
    if (invoice.status !== "BROUILLON") throw new BillingError("NOT_A_DRAFT", "Cette facture est déjà émise.");
    if (invoice.lines.length === 0) throw new BillingError("EMPTY_INVOICE", "Ajoutez au moins une ligne avant d'émettre la facture.");

    // Never trust stored or browser-provided totals: recompute from the lines.
    const totals = compute(invoice.lines, invoice.vatRate);
    const isCreditNote = invoice.creditNoteOfId !== null;
    if (!isCreditNote && totals.totalTtc <= 0) {
      throw new BillingError("INVALID", "Le montant de la facture doit être supérieur à zéro.");
    }
    for (const line of totals.lines) {
      const stored = invoice.lines[line.position - 1]!;
      await tx.invoiceLine.update({ where: { id: stored.id }, data: { position: line.position, total: line.total } });
    }

    const at = now();
    const number = formatInvoiceNumber(invoiceYear(at), await nextSequence(tx, invoiceYear(at)));
    await tx.invoice.update({
      where: { id },
      data: {
        number,
        status: "EMISE",
        issuedAt: at,
        dueAt: isCreditNote ? null : (invoice.dueAt ?? new Date(at.getTime() + DEFAULT_DUE_DAYS * 86_400_000)),
        totalHt: totals.totalHt,
        totalVat: totals.totalVat,
        totalTtc: totals.totalTtc,
      },
    });
    await recordAudit(tx, { actorId, action: "invoice.issued", entity: "Invoice", entityId: id, diff: { number } });
    return number;
  }

  /** The VAT rate is resolved by the caller: never query the pool while holding a transaction. */
  async function createDraftIn(tx: Tx, input: Omit<DraftInput, "vatRateBp"> & { vatRateBp: number; creditNoteOfId?: string }, actorId: string) {
    const client = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null }, select: { id: true } });
    if (!client) throw new BillingError("CLIENT_NOT_FOUND", "Client introuvable.");
    const totals = compute(input.lines, input.vatRateBp);
    const invoice = await tx.invoice.create({
      data: {
        clientId: client.id,
        vatRate: input.vatRateBp,
        dueAt: input.dueAt ?? null,
        creditNoteOfId: input.creditNoteOfId,
        totalHt: totals.totalHt,
        totalVat: totals.totalVat,
        totalTtc: totals.totalTtc,
        lines: { create: totals.lines.map((l) => ({ position: l.position, label: l.label, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total })) },
      },
    });
    await recordAudit(tx, { actorId, action: "invoice.draft_created", entity: "Invoice", entityId: invoice.id });
    return invoice;
  }

  async function loadForUpdate(tx: Tx, id: string) {
    await lock(tx, id);
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) throw new BillingError("NOT_FOUND", "Facture introuvable.");
    return invoice;
  }

  return {
    async createDraft(input: DraftInput, actorId: string): Promise<string> {
      // Read outside the transaction: with many concurrent emissions a second connection per
      // transaction would exhaust the pool and deadlock.
      const vatRateBp = input.vatRateBp ?? Math.round((await settings.get()).vatPercent * 100);
      const invoice = await prisma.$transaction((tx) => createDraftIn(tx, { ...input, vatRateBp }, actorId), TX_OPTIONS);
      return invoice.id;
    },

    async updateDraft(id: string, patch: Partial<Omit<DraftInput, "clientId">>, actorId: string): Promise<void> {
      await prisma.$transaction(async (tx) => {
        const invoice = await loadForUpdate(tx, id);
        if (invoice.status !== "BROUILLON") throw new BillingError("NOT_A_DRAFT", "Une facture émise ne peut plus être modifiée. Émettez un avoir puis une nouvelle facture.");
        const lines = patch.lines ?? (await tx.invoiceLine.findMany({ where: { invoiceId: id }, orderBy: { position: "asc" } }));
        const vatRateBp = patch.vatRateBp ?? invoice.vatRate;
        const totals = compute(lines, vatRateBp);

        if (patch.lines) {
          await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
          await tx.invoiceLine.createMany({
            data: totals.lines.map((l) => ({ invoiceId: id, position: l.position, label: l.label, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total })),
          });
        }
        await tx.invoice.update({
          where: { id },
          data: {
            vatRate: vatRateBp,
            totalHt: totals.totalHt,
            totalVat: totals.totalVat,
            totalTtc: totals.totalTtc,
            ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
          },
        });
        await recordAudit(tx, { actorId, action: "invoice.draft_updated", entity: "Invoice", entityId: id });
      }, TX_OPTIONS);
    },

    /** Only drafts can be deleted: an issued invoice is part of the accounting trail. */
    async deleteDraft(id: string, actorId: string): Promise<void> {
      await prisma.$transaction(async (tx) => {
        const invoice = await loadForUpdate(tx, id);
        if (invoice.status !== "BROUILLON") throw new BillingError("NOT_A_DRAFT", "Une facture émise ne peut pas être supprimée.");
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.invoice.delete({ where: { id } });
        await recordAudit(tx, { actorId, action: "invoice.draft_deleted", entity: "Invoice", entityId: id });
      }, TX_OPTIONS);
    },

    /** Starts a new draft from an existing invoice (the second half of "credit note, then new invoice"). */
    async duplicateAsDraft(id: string, actorId: string): Promise<string> {
      const source = await prisma.invoice.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
      if (!source) throw new BillingError("NOT_FOUND", "Facture introuvable.");
      if (source.creditNoteOfId) throw new BillingError("CREDIT_NOTE", "Un avoir ne peut pas être dupliqué.");
      return this.createDraft({ clientId: source.clientId, lines: source.lines, vatRateBp: source.vatRate }, actorId);
    },

    /** Emission: numbered `AAAA-NNN`, totals recomputed server-side, then immutable. */
    async issue(id: string, actorId: string): Promise<{ number: string }> {
      const number = await prisma.$transaction((tx) => issueInTx(tx, id, actorId), TX_OPTIONS);
      return { number };
    },

    /** Manual payment, partial allowed. The status follows from the amounts and the due date. */
    async recordPayment(id: string, input: PaymentInput, actorId: string): Promise<{ status: string; amountPaid: number }> {
      if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BillingError("INVALID", "Le montant du paiement doit être un entier positif.");
      return prisma.$transaction(async (tx) => {
        const invoice = await loadForUpdate(tx, id);
        if (invoice.creditNoteOfId) throw new BillingError("CREDIT_NOTE", "Aucun paiement sur un avoir.");
        if (!PAYABLE.includes(invoice.status)) throw new BillingError("NOT_ISSUED", "Seule une facture émise et non soldée peut recevoir un paiement.");
        if (input.amount > amountDue(invoice)) throw new BillingError("OVERPAYMENT", "Le paiement dépasse le reste à payer.");

        await tx.payment.create({
          data: { invoiceId: id, amount: input.amount, method: input.method, paidAt: input.paidAt, reference: input.reference?.trim() || null },
        });
        const amountPaid = invoice.amountPaid + input.amount;
        const status = computeInvoiceStatus({ status: invoice.status, totalTtc: invoice.totalTtc, amountPaid, dueAt: invoice.dueAt }, now());
        await tx.invoice.update({ where: { id }, data: { amountPaid, status } });
        await recordAudit(tx, { actorId, action: "invoice.payment_recorded", entity: "Invoice", entityId: id, diff: { amount: input.amount, method: input.method } });
        return { status, amountPaid };
      }, TX_OPTIONS);
    },

    /**
     * Correction of an issued invoice: a credit note (negative invoice, its own number)
     * cancels it entirely; a new invoice can then be created with `duplicateAsDraft`.
     */
    async cancelWithCreditNote(id: string, reason: string, actorId: string): Promise<{ creditNoteNumber: string; creditNoteId: string }> {
      const cleanReason = reason.trim();
      if (!cleanReason || cleanReason.length > 500) throw new BillingError("INVALID", "Indiquez le motif de l'annulation (500 caractères maximum).");
      return prisma.$transaction(async (tx) => {
        const original = await loadForUpdate(tx, id);
        if (original.creditNoteOfId) throw new BillingError("CREDIT_NOTE", "Un avoir ne peut pas être annulé.");
        if (original.status === "ANNULEE") throw new BillingError("ALREADY_CANCELLED", "Cette facture est déjà annulée.");
        if (original.status === "BROUILLON") throw new BillingError("NOT_ISSUED", "Supprimez le brouillon au lieu de l'annuler.");
        if (original.amountPaid > 0) throw new BillingError("HAS_PAYMENTS", "Des paiements sont enregistrés sur cette facture : régularisez-les avant de l'annuler.");

        const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id }, orderBy: { position: "asc" } });
        const credit = await createDraftIn(tx, { clientId: original.clientId, lines: negateLines(lines), vatRateBp: original.vatRate, creditNoteOfId: original.id }, actorId);
        const creditNoteNumber = await issueInTx(tx, credit.id, actorId);

        const at = now();
        await tx.invoice.update({ where: { id }, data: { status: "ANNULEE", cancelledAt: at, cancelReason: cleanReason } });
        await recordAudit(tx, { actorId, action: "invoice.cancelled", entity: "Invoice", entityId: id, diff: { creditNote: creditNoteNumber, reason: cleanReason } });
        return { creditNoteNumber, creditNoteId: credit.id };
      }, TX_OPTIONS);
    },

    /** The FNE number typed in after issuing the normalised invoice on the DGI platform. */
    async recordFneNumber(id: string, fneNumber: string | null, actorId: string): Promise<void> {
      const value = fneNumber?.trim() || null;
      if (value && value.length > 60) throw new BillingError("INVALID", "Numéro FNE trop long.");
      await prisma.$transaction(async (tx) => {
        const invoice = await loadForUpdate(tx, id);
        if (invoice.status === "BROUILLON") throw new BillingError("NOT_ISSUED", "Émettez la facture avant de renseigner son numéro FNE.");
        await tx.invoice.update({ where: { id }, data: { fneNumber: value } });
        await recordAudit(tx, { actorId, action: "invoice.fne_recorded", entity: "Invoice", entityId: id, diff: { fneNumber: value } });
      }, TX_OPTIONS);
    },

    async fneStatus(id: string) {
      const invoice = await prisma.invoice.findUnique({ where: { id } });
      if (!invoice?.number) throw new BillingError("NOT_ISSUED", "Facture non émise.");
      return fne.getStatus({ id: invoice.id, number: invoice.number, fneNumber: invoice.fneNumber });
    },

    /** Manual reminder (the scheduled ones come from the worker). The cap of 3 still applies. */
    async remind(id: string, actorId: string): Promise<{ reminderNumber: number }> {
      const outcome = await sendInvoiceReminder({ prisma, queue, invoiceId: id, appUrl, now: now(), actorId, manual: true });
      if (!outcome.sent) {
        throw new BillingError(outcome.reason === "NOT_FOUND" ? "NOT_FOUND" : "REMINDER_REFUSED", REMINDER_MESSAGES[outcome.reason]);
      }
      return { reminderNumber: outcome.reminderNumber };
    },

    /** Turns reminders on or off for one invoice (automatic reminders only). */
    async setRemindersEnabled(id: string, enabled: boolean, actorId: string): Promise<void> {
      const { count } = await prisma.invoice.updateMany({ where: { id }, data: { remindersDisabled: !enabled } });
      if (count === 0) throw new BillingError("NOT_FOUND", "Facture introuvable.");
      await recordAudit(prisma, { actorId, action: "invoice.reminders_toggled", entity: "Invoice", entityId: id, diff: { enabled } });
    },

    async list(): Promise<Invoice[]> {
      const rows = await prisma.invoice.findMany({ orderBy: { createdAt: "desc" }, include });
      return rows.map(toFrontInvoice);
    },

    async get(id: string): Promise<Invoice | null> {
      const row = await prisma.invoice.findUnique({ where: { id }, include });
      return row ? toFrontInvoice(row) : null;
    },

    /** Invoice, its client (as a prospect) and its history, built from the audit log. */
    async detail(id: string) {
      const row = await prisma.invoice.findUnique({ where: { id }, include });
      if (!row) return null;
      const log = await prisma.auditLog.findMany({
        where: { entity: "Invoice", entityId: id, action: { not: "invoice.reminders_toggled" } },
        orderBy: { createdAt: "asc" },
      });
      return {
        invoice: toFrontInvoice(row),
        client: toFrontProspect(row.client.prospect),
        events: log.map((entry) => ({ label: auditLabel(entry.action, entry.diff), at: entry.createdAt.toISOString() })),
      };
    },

    /** Non-binding preview of the next number (the real one is assigned at emission). */
    async previewNextNumber(): Promise<string> {
      const year = invoiceYear(now());
      const counter = await prisma.invoiceCounter.findUnique({ where: { year } });
      return formatInvoiceNumber(year, (counter?.value ?? 0) + 1);
    },
  };
}

export type InvoiceService = ReturnType<typeof createInvoiceService>;
