import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runMarkOverdue, runPaymentReminders } from "../src/jobs/invoices";
import { db, makeDeps, resetDatabase, shutdown } from "./helpers";

const DAY = 86_400_000;
const due = new Date("2026-10-01T00:00:00Z");
const day = (n: number) => new Date(due.getTime() + n * DAY);

let counter = 0;
let clientId: string;

async function invoice(extra: Record<string, unknown> = {}) {
  counter += 1;
  return db().invoice.create({
    data: {
      clientId,
      number: `2026-${String(counter).padStart(3, "0")}`,
      status: "EMISE",
      vatRate: 1800,
      totalHt: 800_000,
      totalVat: 144_000,
      totalTtc: 944_000,
      issuedAt: new Date("2026-09-01T00:00:00Z"),
      dueAt: due,
      ...extra,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  const prospect = await db().prospect.create({
    data: { companyName: "Lagune Hôtel", companyNameNorm: "lagune hotel", contactName: "Awa Koné", email: "awa@lagune.ci", sector: "x", source: "MANUEL", status: "CLIENT" },
  });
  clientId = (await db().client.create({ data: { prospectId: prospect.id, legalName: "Lagune Hôtel" } })).id;
});
afterAll(shutdown);

describe("invoices.mark-overdue", () => {
  it("flags unpaid and partly paid invoices past their due date", async () => {
    const unpaid = await invoice();
    const partial = await invoice({ status: "PARTIELLEMENT_PAYEE", amountPaid: 100_000 });
    const { deps } = makeDeps({ now: () => day(1) });

    expect(await runMarkOverdue(deps)).toEqual({ marked: 2 });
    expect((await db().invoice.findUniqueOrThrow({ where: { id: unpaid.id } })).status).toBe("EN_RETARD");
    expect((await db().invoice.findUniqueOrThrow({ where: { id: partial.id } })).status).toBe("EN_RETARD");
    const log = await db().auditLog.findFirstOrThrow({ where: { entityId: partial.id } });
    expect(log).toMatchObject({ action: "invoice.overdue", actorId: null, diff: { from: "PARTIELLEMENT_PAYEE", to: "EN_RETARD" } });
  });

  it("leaves everything else alone", async () => {
    const notYetDue = await invoice({ dueAt: day(30) });
    const paid = await invoice({ status: "PAYEE", amountPaid: 944_000 });
    const cancelled = await invoice({ status: "ANNULEE" });
    const draft = await db().invoice.create({ data: { clientId, vatRate: 1800, totalHt: 1, totalVat: 0, totalTtc: 1, dueAt: due } });
    const credit = await invoice({ creditNoteOfId: cancelled.id, dueAt: null, totalTtc: -944_000, totalHt: -800_000, totalVat: -144_000 });
    const { deps } = makeDeps({ now: () => day(1) });

    expect(await runMarkOverdue(deps)).toEqual({ marked: 0 });
    for (const [row, status] of [[notYetDue, "EMISE"], [paid, "PAYEE"], [cancelled, "ANNULEE"], [draft, "BROUILLON"], [credit, "EMISE"]] as const) {
      expect((await db().invoice.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(status);
    }
  });

  it("is idempotent and treats the due instant itself as not yet overdue", async () => {
    await invoice();
    const exactly = makeDeps({ now: () => due });
    expect(await runMarkOverdue(exactly.deps)).toEqual({ marked: 0 });
    const later = makeDeps({ now: () => day(1) });
    expect(await runMarkOverdue(later.deps)).toEqual({ marked: 1 });
    expect(await runMarkOverdue(later.deps)).toEqual({ marked: 0 });
    expect(await db().auditLog.count({ where: { action: "invoice.overdue" } })).toBe(1);
  });
});

describe("invoices.payment-reminders", () => {
  const run = (now: Date) => {
    const made = makeDeps({ now: () => now });
    return { ...made, result: runPaymentReminders(made.deps) };
  };

  it("sends nothing before the first reminder date", async () => {
    await invoice({ status: "EN_RETARD" });
    const { queue, result } = run(day(2.9));
    expect(await result).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(queue.emails).toHaveLength(0);
  });

  it("follows the J+3, J+10, J+20 schedule and then stops", async () => {
    const inv = await invoice({ status: "EN_RETARD" });
    const sentAt = async (offset: number) => {
      const { queue, result } = run(day(offset));
      await result;
      return queue.emails;
    };

    const first = await sentAt(3);
    expect(first).toMatchObject([{ job: { template: "payment-reminder", to: "awa@lagune.ci", data: { name: "Awa Koné", invoiceNumber: inv.number, amountDue: 944_000 } }, dedupeKey: `reminder:${inv.id}:1` }]);
    expect(await sentAt(3.5)).toHaveLength(0); // same schedule slot: nothing more
    expect(await sentAt(9)).toHaveLength(0);
    expect((await sentAt(10))[0]).toMatchObject({ dedupeKey: `reminder:${inv.id}:2` });
    expect(await sentAt(15)).toHaveLength(0);
    expect((await sentAt(20))[0]).toMatchObject({ dedupeKey: `reminder:${inv.id}:3` });
    expect(await sentAt(60)).toHaveLength(0); // never more than 3

    const row = await db().invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row).toMatchObject({ remindersSent: 3, lastReminderAt: day(20) });
  });

  it("logs each reminder, and sends only one per run even when far behind", async () => {
    const inv = await invoice({ status: "EN_RETARD" });
    const { queue, result } = run(day(40));
    await result;
    expect(queue.emails).toHaveLength(1);
    const log = await db().auditLog.findMany({ where: { entityId: inv.id, action: "invoice.reminder_sent" } });
    expect(log).toMatchObject([{ actorId: null, diff: { reminderNumber: 1, manual: false } }]);
  });

  it("reminds about what is still due on a partly paid invoice", async () => {
    await invoice({ status: "EN_RETARD", amountPaid: 244_000 });
    const { queue, result } = run(day(5));
    await result;
    expect(queue.emails[0]!.job).toMatchObject({ data: { amountDue: 700_000 } });
  });

  it("skips paid, cancelled, draft and credit-note invoices", async () => {
    await invoice({ status: "PAYEE", amountPaid: 944_000 });
    const cancelled = await invoice({ status: "ANNULEE" });
    await invoice({ creditNoteOfId: cancelled.id, dueAt: day(-10), totalTtc: -1, totalHt: -1, totalVat: 0 });
    const { queue, result } = run(day(30));
    expect(await result).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(queue.emails).toHaveLength(0);
  });

  it("respects the per-invoice switch", async () => {
    await invoice({ status: "EN_RETARD", remindersDisabled: true });
    const { queue, result } = run(day(30));
    await result;
    expect(queue.emails).toHaveLength(0);
  });

  it("skips a client without an email and carries on with the others", async () => {
    await invoice({ status: "EN_RETARD" });
    const noMail = await db().prospect.create({ data: { companyName: "Sans Mail", companyNameNorm: "sans mail", sector: "x", source: "MANUEL", status: "CLIENT" } });
    const other = await db().client.create({ data: { prospectId: noMail.id, legalName: "Sans Mail" } });
    await invoice({ status: "EN_RETARD", clientId: other.id, dueAt: day(-100) });

    const { queue, result } = run(day(5));
    expect(await result).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(queue.emails).toHaveLength(1);
    expect(await db().invoice.count({ where: { remindersSent: 0 } })).toBe(1);
  });

  it("counts a queue failure, gives the reminder back, and does not block the other invoices", async () => {
    const first = await invoice({ status: "EN_RETARD" });
    const second = await invoice({ status: "EN_RETARD" });
    const made = makeDeps({ now: () => day(5) });
    let calls = 0;
    made.deps.queue = {
      enqueueEmail: async (job, options) => {
        calls++;
        if (calls === 1) throw new Error("queue down");
        await made.queue.enqueueEmail(job, options);
      },
      enqueueFanout: async () => undefined,
    };

    expect(await runPaymentReminders(made.deps)).toEqual({ sent: 1, skipped: 0, failed: 1 });
    const counts = await Promise.all([first, second].map(async (i) => (await db().invoice.findUniqueOrThrow({ where: { id: i.id } })).remindersSent));
    expect(counts.sort()).toEqual([0, 1]); // the failed one will be retried by the next run
  });

  it("never sends the same reminder twice when two runs overlap", async () => {
    await invoice({ status: "EN_RETARD" });
    const a = makeDeps({ now: () => day(5) });
    const b = makeDeps({ now: () => day(5) });
    const [first, second] = await Promise.all([runPaymentReminders(a.deps), runPaymentReminders(b.deps)]);
    expect(first.sent + second.sent).toBe(1);
    expect(a.queue.emails.length + b.queue.emails.length).toBe(1);
  });
});
