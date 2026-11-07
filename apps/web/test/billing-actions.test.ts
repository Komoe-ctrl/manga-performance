import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/server/actions/billing";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
// The real queue would start pg-boss: capture the emails instead.
const emails: unknown[] = [];
vi.mock("@/server/queue", () => ({
  getEnqueuer: async () => ({
    enqueueEmail: async (job: unknown) => void emails.push(job),
    enqueueFanout: async () => undefined,
  }),
}));

const frontInput = (clientId: string, extra: object = {}) => ({
  clientId,
  lines: [
    { label: "Audit", quantity: 1, unitPrice: 500_000 },
    { label: "Formation", quantity: 1.5, unitPrice: 200_000 },
  ],
  vatRate: 0.18,
  dueAt: "2026-12-15T00:00:00Z",
  status: "emise",
  ...extra,
});

const allActions: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
  ["listInvoices", () => actions.listInvoicesAction()],
  ["getInvoice", () => actions.getInvoiceAction("x")],
  ["getInvoiceDetail", () => actions.getInvoiceDetailAction("x")],
  ["nextInvoiceNumber", () => actions.nextInvoiceNumberAction()],
  ["createInvoice", () => actions.createInvoiceAction(frontInput("x"))],
  ["updateInvoice", () => actions.updateInvoiceAction("x", { fneNumber: "F" })],
  ["remindInvoice", () => actions.remindInvoiceAction("x")],
  ["issueInvoice", () => actions.issueInvoiceAction("x")],
  ["recordPayment", () => actions.recordPaymentAction({ id: "x", amount: 1, method: "ESPECES", paidAt: "2026-11-06T10:00:00Z" })],
  ["cancelInvoice", () => actions.cancelInvoiceAction({ id: "x", reason: "r" })],
  ["deleteDraftInvoice", () => actions.deleteDraftInvoiceAction("x")],
  ["duplicateInvoice", () => actions.duplicateInvoiceAction("x")],
  ["setInvoiceReminders", () => actions.setInvoiceRemindersAction("x", true)],
];

beforeEach(async () => {
  await resetDatabase();
  actAs(null);
  emails.length = 0;
});
afterAll(shutdown);

describe("billing actions are admin-only", () => {
  it.each(allActions)("%s refuses anonymous visitors", async (_name, call) => {
    expect(await call()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(allActions)("%s refuses a client session", async (_name, call) => {
    const client = await createClientCompany("Acme");
    const user = await createUser({ role: "CLIENT", clientId: client.id });
    actAs((await login(user.email)).cookie);
    expect(await call()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it.each(allActions)("%s refuses an admin who has not enrolled 2FA", async (_name, call) => {
    const admin = await createUser({ role: "ADMIN" });
    actAs((await login(admin.email)).cookie);
    expect(await call()).toMatchObject({ ok: false, code: "TWO_FACTOR_REQUIRED" });
  });
});

describe("billing actions as an admin", () => {
  async function actAsAdmin() {
    const admin = await createUser({ role: "ADMIN" });
    const { cookie } = await login(admin.email);
    await db().user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
    actAs(cookie);
    const client = await createClientCompany("Lagune Hôtel");
    await db().prospect.updateMany({ data: { email: "awa@lagune.ci", contactName: "Awa" } });
    const prospectId = (await db().client.findUniqueOrThrow({ where: { id: client.id } })).prospectId;
    return { admin, prospectId };
  }

  it("creates and issues an invoice from the front's input, and returns it in the front's shape", async () => {
    const { prospectId } = await actAsAdmin();
    const result = await actions.createInvoiceAction(frontInput(prospectId));
    expect(result).toMatchObject({
      ok: true,
      data: { number: expect.stringMatching(/^\d{4}-001$/), status: "en_attente", clientId: prospectId, vatRate: 0.18, remindersSent: 0 },
    });
    if (!result.ok) throw new Error("setup failed");
    expect(result.data.lines).toEqual([
      { label: "Audit", quantity: 1, unitPrice: 500_000 },
      { label: "Formation", quantity: 1.5, unitPrice: 200_000 },
    ]);
    const stored = await db().invoice.findFirstOrThrow();
    expect(stored).toMatchObject({ totalHt: 800_000, totalVat: 144_000, totalTtc: 944_000, dueAt: new Date("2026-12-15T00:00:00Z") });
  });

  it("saves a draft when asked, and records the FNE number given at creation", async () => {
    const { prospectId } = await actAsAdmin();
    const draft = await actions.createInvoiceAction(frontInput(prospectId, { status: "brouillon" }));
    expect(draft).toMatchObject({ ok: true, data: { number: "Brouillon", status: "brouillon" } });

    const withFne = await actions.createInvoiceAction(frontInput(prospectId, { fneNumber: "FNE-1" }));
    expect(withFne).toMatchObject({ ok: true, data: { fneNumber: "FNE-1" } });
  });

  it("ignores any total sent by the browser", async () => {
    const { prospectId } = await actAsAdmin();
    await actions.createInvoiceAction({ ...frontInput(prospectId), totalHt: 1, totalTtc: 1 });
    expect((await db().invoice.findFirstOrThrow()).totalTtc).toBe(944_000);
  });

  it("rejects invalid input and unknown clients, and leaves no draft behind", async () => {
    const { prospectId } = await actAsAdmin();
    expect(await actions.createInvoiceAction(frontInput(prospectId, { vatRate: 5 }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.createInvoiceAction(frontInput(prospectId, { lines: [{ label: "", quantity: 1, unitPrice: 1 }] }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.createInvoiceAction(frontInput("unknown"))).toMatchObject({ ok: false, code: "CLIENT_NOT_FOUND" });
    // Emission fails (no lines): the draft created for it is removed again.
    expect(await actions.createInvoiceAction(frontInput(prospectId, { lines: [] }))).toMatchObject({ ok: false, code: "EMPTY_INVOICE" });
    expect(await db().invoice.count()).toBe(0);
  });

  it("marks an invoice as paid by recording the remaining amount", async () => {
    const { prospectId } = await actAsAdmin();
    const created = await actions.createInvoiceAction(frontInput(prospectId));
    if (!created.ok) throw new Error("setup failed");
    await actions.recordPaymentAction({ id: created.data.id, amount: 400_000, method: "VIREMENT", paidAt: "2026-11-06T10:00:00Z" });

    const paid = await actions.updateInvoiceAction(created.data.id, { status: "payee" });
    expect(paid).toMatchObject({ ok: true, data: { status: "payee" } });
    expect((await db().payment.findMany({ orderBy: { amount: "asc" } })).map((p) => p.amount)).toEqual([400_000, 544_000]);
    expect(await actions.updateInvoiceAction(created.data.id, { status: "payee" })).toMatchObject({ ok: false, code: "NOT_ISSUED" });
  });

  it("only accepts the edits the back-office needs on an issued invoice", async () => {
    const { prospectId } = await actAsAdmin();
    const created = await actions.createInvoiceAction(frontInput(prospectId));
    if (!created.ok) throw new Error("setup failed");
    expect(await actions.updateInvoiceAction(created.data.id, { status: "annulee" })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.updateInvoiceAction(created.data.id, { totalTtc: 1 })).toMatchObject({ ok: true }); // unknown keys are ignored
    expect((await db().invoice.findFirstOrThrow()).totalTtc).toBe(944_000);
    expect(await actions.updateInvoiceAction(created.data.id, { fneNumber: "FNE-9" })).toMatchObject({ ok: true, data: { fneNumber: "FNE-9" } });
  });

  it("sends reminders and returns the updated invoice", async () => {
    const { prospectId } = await actAsAdmin();
    const created = await actions.createInvoiceAction(frontInput(prospectId));
    if (!created.ok) throw new Error("setup failed");
    expect(await actions.remindInvoiceAction(created.data.id)).toMatchObject({ ok: true, data: { remindersSent: 1 } });
    expect(emails).toMatchObject([{ template: "payment-reminder", to: "awa@lagune.ci" }]);
  });

  it("returns business errors as results, never as exceptions", async () => {
    await actAsAdmin();
    expect(await actions.issueInvoiceAction("nope")).toMatchObject({ ok: false, code: "NOT_FOUND", error: "Facture introuvable." });
    expect(await actions.recordPaymentAction({ id: "x", amount: -1, method: "ESPECES", paidAt: "2026-11-06T10:00:00Z" })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.cancelInvoiceAction({ id: "x", reason: "" })).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("runs the whole life of an invoice through actions", async () => {
    const { prospectId } = await actAsAdmin();
    const created = await actions.createInvoiceAction(frontInput(prospectId, { status: "brouillon" }));
    if (!created.ok) throw new Error("setup failed");
    const id = created.data.id;
    expect(await actions.nextInvoiceNumberAction()).toMatchObject({ ok: true, data: expect.stringMatching(/-001$/) });

    expect(await actions.issueInvoiceAction(id)).toMatchObject({ ok: true, data: { number: expect.stringMatching(/-001$/) } });
    expect(await actions.recordPaymentAction({ id, amount: 944_000, method: "MOBILE_MONEY", paidAt: "2026-11-06T10:00:00Z" })).toMatchObject({ ok: true, data: { status: "PAYEE" } });
    const detail = await actions.getInvoiceDetailAction(id);
    expect(detail.ok && detail.data?.events.map((e) => e.label)).toEqual([
      "Facture créée (brouillon)",
      expect.stringMatching(/^Facture émise/),
      "Paiement de 944 000 FCFA enregistré",
    ]);

    const second = await actions.createInvoiceAction(frontInput(prospectId));
    if (!second.ok) throw new Error("setup failed");
    expect(await actions.cancelInvoiceAction({ id: second.data.id, reason: "Erreur" })).toMatchObject({ ok: true });
    expect(await actions.duplicateInvoiceAction(second.data.id)).toMatchObject({ ok: true });
    const list = await actions.listInvoicesAction();
    expect(list.ok && list.data.map((i) => i.status).sort()).toEqual(["annulee", "brouillon", "en_attente", "payee"].sort());
  });
});
