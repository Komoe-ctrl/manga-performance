"use server";

import {
  cancelInvoiceSchema,
  createInvoiceInputSchema,
  recordPaymentSchema,
  updateInvoicePatchSchema,
} from "@manga/validation";
import { z } from "zod";
import { amountDue } from "@manga/core";
import { BillingError } from "../billing/errors";
import { getBilling } from "../billing/instance";
import { getPrisma } from "../db";
import { parseInput, runAdmin } from "./result";

const idSchema = z.string().min(1).max(64);

/** The front speaks prospect ids; the database speaks `Client.id`. */
async function clientIdOfProspect(prospectId: string): Promise<string> {
  const client = await getPrisma().client.findFirst({
    where: { prospectId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new BillingError("CLIENT_NOT_FOUND", "Ce prospect n'est pas encore client.");
  return client.id;
}

async function mustGet(id: string) {
  const invoice = await getBilling().get(id);
  if (!invoice) throw new BillingError("NOT_FOUND", "Facture introuvable.");
  return invoice;
}

// Every action goes through `runAdmin`, which calls `requireAdmin()` first (spec, section 5).

export async function listInvoicesAction() {
  return runAdmin(() => getBilling().list());
}

export async function getInvoiceAction(id: unknown) {
  return runAdmin(() => getBilling().get(parseInput(idSchema, id)));
}

export async function getInvoiceDetailAction(id: unknown) {
  return runAdmin(() => getBilling().detail(parseInput(idSchema, id)));
}

export async function nextInvoiceNumberAction() {
  return runAdmin(() => getBilling().previewNextNumber());
}

/** Creates a draft, and issues it straight away when `status` is `emise`. */
export async function createInvoiceAction(input: unknown) {
  return runAdmin(async (admin) => {
    const data = parseInput(createInvoiceInputSchema, input);
    const billing = getBilling();
    const draftId = await billing.createDraft(
      {
        clientId: await clientIdOfProspect(data.clientId),
        lines: data.lines.map((line) => ({
          label: line.label,
          quantity: Math.round(line.quantity * 100),
          unitPrice: line.unitPrice,
        })),
        vatRateBp: Math.round(data.vatRate * 10_000),
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
      },
      admin.userId,
    );

    if (data.status === "emise") {
      try {
        await billing.issue(draftId, admin.userId);
        if (data.fneNumber) await billing.recordFneNumber(draftId, data.fneNumber, admin.userId);
      } catch (error) {
        // Do not leave a half-finished draft behind a failed emission.
        await billing.deleteDraft(draftId, admin.userId).catch(() => undefined);
        throw error;
      }
    }
    return mustGet(draftId);
  });
}

/** The back-office's two edits on an issued invoice: the FNE number, and "mark as paid". */
export async function updateInvoiceAction(id: unknown, patch: unknown) {
  return runAdmin(async (admin) => {
    const invoiceId = parseInput(idSchema, id);
    const data = parseInput(updateInvoicePatchSchema, patch);
    const billing = getBilling();

    if (data.fneNumber !== undefined) await billing.recordFneNumber(invoiceId, data.fneNumber, admin.userId);
    if (data.status === "payee") {
      const prisma = getPrisma();
      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new BillingError("NOT_FOUND", "Facture introuvable.");
      const remaining = amountDue(invoice);
      if (remaining === 0) throw new BillingError("NOT_ISSUED", "Cette facture est déjà soldée.");
      await billing.recordPayment(invoiceId, { amount: remaining, method: "AUTRE", paidAt: new Date() }, admin.userId);
    }
    return mustGet(invoiceId);
  });
}

export async function remindInvoiceAction(id: unknown) {
  return runAdmin(async (admin) => {
    const invoiceId = parseInput(idSchema, id);
    await getBilling().remind(invoiceId, admin.userId);
    return mustGet(invoiceId);
  });
}

// Not used by the current screens yet; ready for the invoice detail page.

export async function issueInvoiceAction(id: unknown) {
  return runAdmin((admin) => getBilling().issue(parseInput(idSchema, id), admin.userId));
}

export async function recordPaymentAction(input: unknown) {
  return runAdmin((admin) => {
    const data = parseInput(recordPaymentSchema, input);
    return getBilling().recordPayment(
      data.id,
      { amount: data.amount, method: data.method, paidAt: new Date(data.paidAt), reference: data.reference },
      admin.userId,
    );
  });
}

export async function cancelInvoiceAction(input: unknown) {
  return runAdmin((admin) => {
    const data = parseInput(cancelInvoiceSchema, input);
    return getBilling().cancelWithCreditNote(data.id, data.reason, admin.userId);
  });
}

export async function deleteDraftInvoiceAction(id: unknown) {
  return runAdmin(async (admin) => {
    await getBilling().deleteDraft(parseInput(idSchema, id), admin.userId);
    return { deleted: true };
  });
}

export async function duplicateInvoiceAction(id: unknown) {
  return runAdmin(async (admin) => ({ id: await getBilling().duplicateAsDraft(parseInput(idSchema, id), admin.userId) }));
}

export async function setInvoiceRemindersAction(id: unknown, enabled: unknown) {
  return runAdmin(async (admin) => {
    await getBilling().setRemindersEnabled(parseInput(idSchema, id), parseInput(z.boolean(), enabled), admin.userId);
    return { enabled: enabled as boolean };
  });
}
