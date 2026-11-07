import type { EmailJob } from "@manga/emails";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BillingError } from "@/server/billing/errors";
import { createInvoiceService } from "@/server/billing/invoice-service";
import { createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";

const DAY = 86_400_000;
let clock: Date;
let actorId: string;
let clientId: string;
let sent: { job: EmailJob; dedupeKey?: string }[];

const service = () =>
  createInvoiceService({
    prisma: db(),
    queue: {
      enqueueEmail: async (job, options) => {
        sent.push({ job, dedupeKey: options?.dedupeKey });
      },
    },
    appUrl: "https://app.example.com",
    now: () => clock,
  });

const lines = [
  { label: "Audit financier", quantity: 100, unitPrice: 500_000 },
  { label: "Formation", quantity: 150, unitPrice: 200_000 },
];
// HT 800 000, TVA 18 % = 144 000, TTC 944 000.

async function issuedInvoice(extra: { dueAt?: Date | null } = {}) {
  const id = await service().createDraft({ clientId, lines, dueAt: extra.dueAt }, actorId);
  const { number } = await service().issue(id, actorId);
  return { id, number };
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BillingError) return error;
    throw error;
  }
  throw new Error("expected a BillingError");
};

/** Raw SQL error text, to assert what the database itself refuses. */
const sqlError = async (query: () => Promise<unknown>) => {
  try {
    await query();
  } catch (error) {
    return String((error as Error).message);
  }
  return null;
};

beforeEach(async () => {
  await resetDatabase();
  clock = new Date("2026-11-06T09:00:00Z");
  sent = [];
  actorId = (await createUser({ role: "ADMIN" })).id;
  clientId = (await createClientCompany("Lagune Hôtel")).id;
});
afterAll(shutdown);

describe("drafts", () => {
  it("computes totals server-side, with the VAT rate of the settings, and no number", async () => {
    const id = await service().createDraft({ clientId, lines }, actorId);
    const invoice = await db().invoice.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
    expect(invoice).toMatchObject({ status: "BROUILLON", number: null, issuedAt: null, vatRate: 1800, totalHt: 800_000, totalVat: 144_000, totalTtc: 944_000 });
    expect(invoice.lines.map((l) => [l.position, l.total])).toEqual([[1, 500_000], [2, 300_000]]);
    expect(await db().auditLog.count({ where: { entityId: id, action: "invoice.draft_created" } })).toBe(1);
  });

  it("follows the VAT rate configured in the settings, unless one is given", async () => {
    await db().setting.create({ data: { key: "cabinet", value: { vatPercent: 0 } } });
    const free = await service().createDraft({ clientId, lines }, actorId);
    expect((await db().invoice.findUniqueOrThrow({ where: { id: free } })).totalVat).toBe(0);
    const taxed = await service().createDraft({ clientId, lines, vatRateBp: 1000 }, actorId);
    expect((await db().invoice.findUniqueOrThrow({ where: { id: taxed } })).totalVat).toBe(80_000);
  });

  it("can be edited freely: lines are replaced and totals recomputed", async () => {
    const id = await service().createDraft({ clientId, lines }, actorId);
    await service().updateDraft(id, { lines: [{ label: "Mission", quantity: 100, unitPrice: 100_000 }], dueAt: new Date("2026-12-01T00:00:00Z") }, actorId);
    const invoice = await db().invoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(invoice).toMatchObject({ totalHt: 100_000, totalVat: 18_000, totalTtc: 118_000, dueAt: new Date("2026-12-01T00:00:00Z") });
    expect(invoice.lines).toHaveLength(1);

    await service().updateDraft(id, { vatRateBp: 0 }, actorId);
    expect((await db().invoice.findUniqueOrThrow({ where: { id } })).totalTtc).toBe(100_000);
  });

  it("can be duplicated from any invoice, and deleted while still a draft", async () => {
    const { id } = await issuedInvoice();
    const copy = await service().duplicateAsDraft(id, actorId);
    const draft = await db().invoice.findUniqueOrThrow({ where: { id: copy }, include: { lines: true } });
    expect(draft).toMatchObject({ status: "BROUILLON", number: null, totalTtc: 944_000 });
    expect(draft.lines).toHaveLength(2);

    await service().deleteDraft(copy, actorId);
    expect(await db().invoice.count({ where: { id: copy } })).toBe(0);
    expect(await db().invoiceLine.count({ where: { invoiceId: copy } })).toBe(0);
    expect(await db().auditLog.count({ where: { entityId: copy, action: "invoice.draft_deleted" } })).toBe(1);
  });

  it("rejects invalid input", async () => {
    expect((await failure(service().createDraft({ clientId: "nope", lines }, actorId))).code).toBe("CLIENT_NOT_FOUND");
    const gone = await createClientCompany("Supprimée", new Date());
    expect((await failure(service().createDraft({ clientId: gone.id, lines }, actorId))).code).toBe("CLIENT_NOT_FOUND");
    expect((await failure(service().createDraft({ clientId, lines: [{ label: " ", quantity: 100, unitPrice: 1 }] }, actorId))).code).toBe("INVALID");
    expect((await failure(service().createDraft({ clientId, lines: [{ label: "x", quantity: 1.5, unitPrice: 1 }] }, actorId))).code).toBe("INVALID");
    expect((await failure(service().createDraft({ clientId, lines, vatRateBp: 20_000 }, actorId))).code).toBe("INVALID");
    const many = Array.from({ length: 101 }, (_, i) => ({ label: `L${i}`, quantity: 100, unitPrice: 1 }));
    expect((await failure(service().createDraft({ clientId, lines: many }, actorId))).code).toBe("INVALID");
    expect(await db().invoice.count()).toBe(0);
  });
});

describe("emission", () => {
  it("numbers the invoice AAAA-NNN, freezes it and sets a 30-day due date by default", async () => {
    const { id, number } = await issuedInvoice();
    expect(number).toBe("2026-001");
    const invoice = await db().invoice.findUniqueOrThrow({ where: { id } });
    expect(invoice).toMatchObject({ number: "2026-001", status: "EMISE", issuedAt: clock, dueAt: new Date(clock.getTime() + 30 * DAY), totalTtc: 944_000 });
    expect(await db().auditLog.count({ where: { entityId: id, action: "invoice.issued" } })).toBe(1);
  });

  it("keeps an explicit due date", async () => {
    const due = new Date("2026-12-15T00:00:00Z");
    const { id } = await issuedInvoice({ dueAt: due });
    expect((await db().invoice.findUniqueOrThrow({ where: { id } })).dueAt).toEqual(due);
  });

  it("never trusts stored totals: they are recomputed from the lines", async () => {
    const id = await service().createDraft({ clientId, lines }, actorId);
    await db().invoice.update({ where: { id }, data: { totalHt: 1, totalVat: 1, totalTtc: 2 } }); // tampered draft
    await db().invoiceLine.updateMany({ where: { invoiceId: id, position: 1 }, data: { total: 7 } });
    await service().issue(id, actorId);

    const invoice = await db().invoice.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
    expect(invoice).toMatchObject({ totalHt: 800_000, totalVat: 144_000, totalTtc: 944_000 });
    expect(invoice.lines.map((l) => l.total)).toEqual([500_000, 300_000]);
  });

  it("refuses empty, zero-amount and already issued invoices", async () => {
    const empty = await service().createDraft({ clientId, lines: [] }, actorId);
    expect((await failure(service().issue(empty, actorId))).code).toBe("EMPTY_INVOICE");
    const zero = await service().createDraft({ clientId, lines: [{ label: "Offert", quantity: 100, unitPrice: 0 }] }, actorId);
    expect((await failure(service().issue(zero, actorId))).code).toBe("INVALID");
    const { id } = await issuedInvoice();
    expect((await failure(service().issue(id, actorId))).code).toBe("NOT_A_DRAFT");
    expect((await failure(service().issue("nope", actorId))).code).toBe("NOT_FOUND");
    // A refused emission consumes no number.
    expect(await db().invoiceCounter.findUnique({ where: { year: 2026 } })).toMatchObject({ value: 1 });
  });

  it("refuses to edit or delete an issued invoice", async () => {
    const { id } = await issuedInvoice();
    expect((await failure(service().updateDraft(id, { vatRateBp: 0 }, actorId))).code).toBe("NOT_A_DRAFT");
    expect((await failure(service().deleteDraft(id, actorId))).code).toBe("NOT_A_DRAFT");
  });
});

describe("numbering", () => {
  it("is consecutive, and restarts each year (Abidjan time)", async () => {
    const numbers: string[] = [];
    for (let i = 0; i < 3; i++) numbers.push((await issuedInvoice()).number);
    expect(numbers).toEqual(["2026-001", "2026-002", "2026-003"]);

    clock = new Date("2026-12-31T23:59:00Z");
    expect((await issuedInvoice()).number).toBe("2026-004");
    clock = new Date("2027-01-01T00:01:00Z");
    expect((await issuedInvoice()).number).toBe("2027-001");
    expect((await issuedInvoice()).number).toBe("2027-002");
  });

  it("gives 20 simultaneous emissions 20 distinct, consecutive numbers", async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => service().createDraft({ clientId, lines }, actorId)));
    const results = await Promise.all(ids.map((id) => service().issue(id, actorId)));

    const sequences = results.map((r) => Number(r.number.split("-")[1])).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.number)).size).toBe(20);
    expect(await db().invoiceCounter.findUnique({ where: { year: 2026 } })).toMatchObject({ value: 20 });
    expect(await db().invoice.count({ where: { number: { not: null } } })).toBe(20);
  });

  it("leaves no gap when an emission fails mid-way", async () => {
    await issuedInvoice(); // 001
    const empty = await service().createDraft({ clientId, lines: [] }, actorId);
    await failure(service().issue(empty, actorId));
    expect((await issuedInvoice()).number).toBe("2026-002");
  });

  it("only lets one of two simultaneous emissions of the same draft win", async () => {
    const id = await service().createDraft({ clientId, lines }, actorId);
    const results = await Promise.allSettled([service().issue(id, actorId), service().issue(id, actorId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().invoiceCounter.findUnique({ where: { year: 2026 } })).toMatchObject({ value: 1 });
  });

  it("previews the next number without consuming it", async () => {
    expect(await service().previewNextNumber()).toBe("2026-001");
    await issuedInvoice();
    expect(await service().previewNextNumber()).toBe("2026-002");
    expect(await service().previewNextNumber()).toBe("2026-002");
  });
});

describe("immutability, enforced by the database itself", () => {
  it("refuses to rewrite an issued invoice, even with raw SQL", async () => {
    const { id } = await issuedInvoice();
    for (const column of ["totalTtc", "totalHt", "totalVat", "vatRate"]) {
      expect(await sqlError(() => db().$executeRawUnsafe(`UPDATE "Invoice" SET "${column}" = 1 WHERE id = '${id}'`))).toMatch(/cannot be modified/);
    }
    expect(await sqlError(() => db().$executeRawUnsafe(`UPDATE "Invoice" SET "number" = '2026-999' WHERE id = '${id}'`))).toMatch(/cannot be modified/);
    expect(await sqlError(() => db().$executeRawUnsafe(`UPDATE "Invoice" SET "dueAt" = now() WHERE id = '${id}'`))).toMatch(/cannot be modified/);
    expect(await sqlError(() => db().$executeRawUnsafe(`UPDATE "Invoice" SET "status" = 'BROUILLON' WHERE id = '${id}'`))).not.toBeNull();
    expect((await db().invoice.findUniqueOrThrow({ where: { id } })).totalTtc).toBe(944_000);
  });

  it("refuses to delete an issued invoice or to touch its lines", async () => {
    const { id } = await issuedInvoice();
    expect(await sqlError(() => db().$executeRawUnsafe(`DELETE FROM "Invoice" WHERE id = '${id}'`))).toMatch(/cannot be deleted/);
    expect(await sqlError(() => db().invoice.delete({ where: { id } }))).not.toBeNull();
    expect(await sqlError(() => db().$executeRawUnsafe(`UPDATE "InvoiceLine" SET "unitPrice" = 1 WHERE "invoiceId" = '${id}'`))).toMatch(/lines of an issued invoice/);
    expect(await sqlError(() => db().$executeRawUnsafe(`DELETE FROM "InvoiceLine" WHERE "invoiceId" = '${id}'`))).toMatch(/lines of an issued invoice/);
    expect(await sqlError(() => db().invoiceLine.create({ data: { invoiceId: id, position: 3, label: "Ajout", quantity: 100, unitPrice: 1, total: 1 } }))).toMatch(/lines of an issued invoice/);
    expect(await db().invoiceLine.count({ where: { invoiceId: id } })).toBe(2);
  });

  it("still allows what must change after emission: payments, status, FNE number, reminders", async () => {
    const { id } = await issuedInvoice();
    await db().invoice.update({ where: { id }, data: { amountPaid: 100, status: "PARTIELLEMENT_PAYEE", fneNumber: "FNE-1", remindersSent: 1, lastReminderAt: clock, cancelReason: "x" } });
    expect(await db().invoice.findUniqueOrThrow({ where: { id } })).toMatchObject({ amountPaid: 100, fneNumber: "FNE-1" });
  });

  it("keeps drafts and numbers consistent: only drafts are unnumbered", async () => {
    const draft = await service().createDraft({ clientId, lines }, actorId);
    expect(await sqlError(() => db().invoice.update({ where: { id: draft }, data: { status: "EMISE" } }))).toMatch(/Invoice_number_matches_status/);
    expect(await sqlError(() => db().invoice.update({ where: { id: draft }, data: { number: "2026-050" } }))).toMatch(/Invoice_number_matches_status/);
  });
});

describe("payments", () => {
  const pay = (id: string, amount: number) => service().recordPayment(id, { amount, method: "VIREMENT", paidAt: clock, reference: " VIR-1 " }, actorId);

  it("tracks partial payments, then settles the invoice", async () => {
    const { id } = await issuedInvoice();
    expect(await pay(id, 400_000)).toEqual({ status: "PARTIELLEMENT_PAYEE", amountPaid: 400_000 });
    expect(await pay(id, 544_000)).toEqual({ status: "PAYEE", amountPaid: 944_000 });
    const payments = await db().payment.findMany({ where: { invoiceId: id }, orderBy: { amount: "asc" } });
    expect(payments.map((p) => p.amount)).toEqual([400_000, 544_000]);
    expect(payments[0]!.reference).toBe("VIR-1");
    expect(await db().auditLog.count({ where: { entityId: id, action: "invoice.payment_recorded" } })).toBe(2);
  });

  it("keeps an overdue invoice overdue until it is fully paid", async () => {
    const { id } = await issuedInvoice({ dueAt: new Date("2026-10-01T00:00:00Z") });
    expect((await pay(id, 100_000)).status).toBe("EN_RETARD");
    expect((await pay(id, 844_000)).status).toBe("PAYEE");
  });

  it("refuses overpayments, bad amounts and invoices that cannot be paid", async () => {
    const { id } = await issuedInvoice();
    expect((await failure(pay(id, 944_001))).code).toBe("OVERPAYMENT");
    expect((await failure(pay(id, 0))).code).toBe("INVALID");
    expect((await failure(pay(id, -5))).code).toBe("INVALID");
    expect((await failure(pay(id, 10.5))).code).toBe("INVALID");

    const draft = await service().createDraft({ clientId, lines }, actorId);
    expect((await failure(pay(draft, 100))).code).toBe("NOT_ISSUED");
    await pay(id, 944_000);
    expect((await failure(pay(id, 1))).code).toBe("NOT_ISSUED");
    expect((await failure(pay("nope", 1))).code).toBe("NOT_FOUND");
  });

  it("never lets simultaneous payments exceed the amount due", async () => {
    const { id } = await issuedInvoice();
    const results = await Promise.allSettled([pay(id, 600_000), pay(id, 600_000), pay(id, 600_000)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db().invoice.findUniqueOrThrow({ where: { id } })).amountPaid).toBe(600_000);
  });
});

describe("credit notes", () => {
  it("cancels an invoice with a negative, numbered, linked invoice", async () => {
    const { id } = await issuedInvoice();
    const { creditNoteNumber, creditNoteId } = await service().cancelWithCreditNote(id, "Erreur sur le client", actorId);
    expect(creditNoteNumber).toBe("2026-002");

    const original = await db().invoice.findUniqueOrThrow({ where: { id } });
    expect(original).toMatchObject({ status: "ANNULEE", cancelReason: "Erreur sur le client", cancelledAt: clock, totalTtc: 944_000 });
    const credit = await db().invoice.findUniqueOrThrow({ where: { id: creditNoteId }, include: { lines: { orderBy: { position: "asc" } } } });
    expect(credit).toMatchObject({ creditNoteOfId: id, status: "EMISE", number: "2026-002", totalHt: -800_000, totalVat: -144_000, totalTtc: -944_000, dueAt: null });
    expect(credit.lines.map((l) => [l.label, l.total])).toEqual([["Audit financier", -500_000], ["Formation", -300_000]]);
    expect(await db().auditLog.count({ where: { entityId: id, action: "invoice.cancelled" } })).toBe(1);
  });

  it("is an exact mirror even with rounding", async () => {
    const odd = [{ label: "A", quantity: 33, unitPrice: 1555 }, { label: "B", quantity: 1, unitPrice: 150 }];
    const id = await service().createDraft({ clientId, lines: odd }, actorId);
    await service().issue(id, actorId);
    const { creditNoteId } = await service().cancelWithCreditNote(id, "Test", actorId);
    const [original, credit] = await Promise.all([db().invoice.findUniqueOrThrow({ where: { id } }), db().invoice.findUniqueOrThrow({ where: { id: creditNoteId } })]);
    expect(credit.totalHt + original.totalHt).toBe(0);
    expect(credit.totalVat + original.totalVat).toBe(0);
    expect(credit.totalTtc + original.totalTtc).toBe(0);
  });

  it("refuses to cancel twice, a draft, a credit note, or an invoice with payments", async () => {
    const { id } = await issuedInvoice();
    const { creditNoteId } = await service().cancelWithCreditNote(id, "Erreur", actorId);
    expect((await failure(service().cancelWithCreditNote(id, "Encore", actorId))).code).toBe("ALREADY_CANCELLED");
    expect((await failure(service().cancelWithCreditNote(creditNoteId, "Annuler l'avoir", actorId))).code).toBe("CREDIT_NOTE");

    const draft = await service().createDraft({ clientId, lines }, actorId);
    expect((await failure(service().cancelWithCreditNote(draft, "x", actorId))).code).toBe("NOT_ISSUED");

    const paid = await issuedInvoice();
    await service().recordPayment(paid.id, { amount: 1000, method: "ESPECES", paidAt: clock }, actorId);
    expect((await failure(service().cancelWithCreditNote(paid.id, "x", actorId))).code).toBe("HAS_PAYMENTS");
    expect((await failure(service().cancelWithCreditNote((await issuedInvoice()).id, "  ", actorId))).code).toBe("INVALID");
  });

  it("creates only one credit note, even when requested twice at once", async () => {
    const { id } = await issuedInvoice();
    const results = await Promise.allSettled([service().cancelWithCreditNote(id, "A", actorId), service().cancelWithCreditNote(id, "B", actorId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().invoice.count({ where: { creditNoteOfId: id } })).toBe(1);
  });

  it("refuses payments on a credit note, and allows the corrected invoice afterwards", async () => {
    const { id } = await issuedInvoice();
    const { creditNoteId } = await service().cancelWithCreditNote(id, "Erreur", actorId);
    expect((await failure(service().recordPayment(creditNoteId, { amount: 1, method: "AUTRE", paidAt: clock }, actorId))).code).toBe("CREDIT_NOTE");
    expect((await failure(service().duplicateAsDraft(creditNoteId, actorId))).code).toBe("CREDIT_NOTE");

    const corrected = await service().duplicateAsDraft(id, actorId);
    const { number } = await service().issue(corrected, actorId);
    expect(number).toBe("2026-003");
  });
});

describe("FNE number", () => {
  it("is recorded after emission through the manual provider, and can be cleared", async () => {
    const { id } = await issuedInvoice();
    expect(await service().fneStatus(id)).toEqual({ status: "PENDING_MANUAL", fneNumber: null });
    await service().recordFneNumber(id, "  FNE-2026-0042 ", actorId);
    expect((await db().invoice.findUniqueOrThrow({ where: { id } })).fneNumber).toBe("FNE-2026-0042");
    expect(await service().fneStatus(id)).toEqual({ status: "RECORDED", fneNumber: "FNE-2026-0042" });
    await service().recordFneNumber(id, "", actorId);
    expect((await db().invoice.findUniqueOrThrow({ where: { id } })).fneNumber).toBeNull();
  });

  it("refuses drafts and absurd values", async () => {
    const draft = await service().createDraft({ clientId, lines }, actorId);
    expect((await failure(service().recordFneNumber(draft, "FNE-1", actorId))).code).toBe("NOT_ISSUED");
    const { id } = await issuedInvoice();
    expect((await failure(service().recordFneNumber(id, "x".repeat(61), actorId))).code).toBe("INVALID");
    expect((await failure(service().fneStatus(draft))).code).toBe("NOT_ISSUED");
  });
});

describe("manual reminders", () => {
  beforeEach(async () => {
    await db().prospect.updateMany({ data: { email: "awa@lagune.ci", contactName: "Awa Koné" } });
  });

  it("queues a payment-reminder email with the amount still due, and logs it", async () => {
    const { id } = await issuedInvoice({ dueAt: new Date("2026-10-01T00:00:00Z") });
    await service().recordPayment(id, { amount: 44_000, method: "VIREMENT", paidAt: clock }, actorId);

    expect(await service().remind(id, actorId)).toEqual({ reminderNumber: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      dedupeKey: `reminder:${id}:1`,
      job: { template: "payment-reminder", to: "awa@lagune.ci", data: { name: "Awa Koné", invoiceNumber: "2026-001", amountDue: 900_000, url: "https://app.example.com/espace-client" } },
    });
    expect(await db().invoice.findUniqueOrThrow({ where: { id } })).toMatchObject({ remindersSent: 1, lastReminderAt: clock });
    const log = await db().auditLog.findFirstOrThrow({ where: { entityId: id, action: "invoice.reminder_sent" } });
    expect(log).toMatchObject({ actorId, diff: { reminderNumber: 1, manual: true } });
  });

  it("stops at three reminders", async () => {
    const { id } = await issuedInvoice();
    for (let i = 1; i <= 3; i++) expect(await service().remind(id, actorId)).toEqual({ reminderNumber: i });
    expect((await failure(service().remind(id, actorId))).message).toMatch(/plafond de 3 relances/);
    expect(sent).toHaveLength(3);
  });

  it("refuses paid, cancelled, draft and credit-note invoices, and clients without an email", async () => {
    const paid = await issuedInvoice();
    await service().recordPayment(paid.id, { amount: 944_000, method: "ESPECES", paidAt: clock }, actorId);
    expect((await failure(service().remind(paid.id, actorId))).code).toBe("REMINDER_REFUSED");

    const cancelled = await issuedInvoice();
    const { creditNoteId } = await service().cancelWithCreditNote(cancelled.id, "x", actorId);
    expect((await failure(service().remind(cancelled.id, actorId))).code).toBe("REMINDER_REFUSED");
    expect((await failure(service().remind(creditNoteId, actorId))).code).toBe("REMINDER_REFUSED");
    expect((await failure(service().remind(await service().createDraft({ clientId, lines }, actorId), actorId))).code).toBe("REMINDER_REFUSED");
    expect((await failure(service().remind("nope", actorId))).code).toBe("NOT_FOUND");

    await db().prospect.updateMany({ data: { email: null } });
    const open = await issuedInvoice();
    expect((await failure(service().remind(open.id, actorId))).message).toMatch(/Aucun email/);
    expect(sent).toHaveLength(0);
  });

  it("does not lose the reminder when the queue is down", async () => {
    const { id } = await issuedInvoice();
    const broken = createInvoiceService({
      prisma: db(),
      queue: { enqueueEmail: async () => { throw new Error("queue down"); } },
      appUrl: "https://app.example.com",
      now: () => clock,
    });
    await expect(broken.remind(id, actorId)).rejects.toThrow("queue down");
    expect((await db().invoice.findUniqueOrThrow({ where: { id } })).remindersSent).toBe(0);
    expect(await service().remind(id, actorId)).toEqual({ reminderNumber: 1 });
  });

  it("can switch reminders off for one invoice without blocking a manual one", async () => {
    const { id } = await issuedInvoice();
    await service().setRemindersEnabled(id, false, actorId);
    expect((await db().invoice.findUniqueOrThrow({ where: { id } })).remindersDisabled).toBe(true);
    expect(await service().remind(id, actorId)).toEqual({ reminderNumber: 1 });
    expect((await failure(service().setRemindersEnabled("nope", true, actorId))).code).toBe("NOT_FOUND");
  });
});

describe("reading invoices", () => {
  beforeEach(async () => {
    await db().prospect.updateMany({ data: { email: "awa@lagune.ci" } });
  });

  it("maps to the front's shape: prospect id as client, decimal quantities, fractional VAT", async () => {
    const draftId = await service().createDraft({ clientId, lines }, actorId);
    const { id } = await issuedInvoice();
    const client = await db().client.findUniqueOrThrow({ where: { id: clientId } });

    const draft = await service().get(draftId);
    expect(draft).toMatchObject({ number: "Brouillon", status: "brouillon", clientId: client.prospectId, vatRate: 0.18 });
    expect(draft!.lines).toEqual([
      { label: "Audit financier", quantity: 1, unitPrice: 500_000 },
      { label: "Formation", quantity: 1.5, unitPrice: 200_000 },
    ]);

    const issued = await service().get(id);
    expect(issued).toMatchObject({ number: "2026-001", status: "en_attente", remindersSent: 0 });
    expect(await service().get("nope")).toBeNull();
    expect((await service().list()).map((i) => i.id).sort()).toEqual([draftId, id].sort());
  });

  it("maps every status", async () => {
    const overdue = await issuedInvoice({ dueAt: new Date("2026-10-01T00:00:00Z") });
    await db().invoice.update({ where: { id: overdue.id }, data: { status: "EN_RETARD" } });
    const paid = await issuedInvoice();
    await service().recordPayment(paid.id, { amount: 944_000, method: "ESPECES", paidAt: clock }, actorId);
    const partial = await issuedInvoice();
    await service().recordPayment(partial.id, { amount: 1000, method: "ESPECES", paidAt: clock }, actorId);
    const cancelled = await issuedInvoice();
    await service().cancelWithCreditNote(cancelled.id, "x", actorId);

    const byId = Object.fromEntries((await service().list()).map((i) => [i.id, i.status]));
    expect(byId[overdue.id]).toBe("en_retard");
    expect(byId[paid.id]).toBe("payee");
    expect(byId[partial.id]).toBe("en_attente");
    expect(byId[cancelled.id]).toBe("annulee");
  });

  it("builds the history from the audit log", async () => {
    const { id } = await issuedInvoice({ dueAt: new Date("2026-10-01T00:00:00Z") });
    await service().recordPayment(id, { amount: 44_000, method: "VIREMENT", paidAt: clock }, actorId);
    await service().remind(id, actorId);
    await service().recordFneNumber(id, "FNE-1", actorId);
    await service().setRemindersEnabled(id, false, actorId);

    const detail = await service().detail(id);
    expect(detail!.events.map((e) => e.label)).toEqual([
      "Facture créée (brouillon)",
      "Facture émise (n° 2026-001)",
      "Paiement de 44 000 FCFA enregistré",
      "Relance n°1 envoyée (manuelle)",
      "N° FNE renseigné",
    ]);
    expect(detail!.client).toMatchObject({ companyName: "Lagune Hôtel", status: "client" });
    expect(await service().detail("nope")).toBeNull();
  });
});
