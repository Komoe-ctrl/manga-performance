import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/invoices/[id]/pdf/route";
import { createInvoiceService } from "@/server/billing/invoice-service";
import { NOT_NORMALISED_NOTICE, buildInvoiceView, loadInvoiceDocument, type InvoiceDocumentData } from "@/server/billing/invoice-document";
import { renderInvoicePdf } from "@/server/billing/invoice-pdf";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
vi.mock("next/server", () => ({ connection: async () => undefined }));

const lines = [
  { label: "Audit financier", quantity: 100, unitPrice: 500_000 },
  { label: "Formation", quantity: 150, unitPrice: 200_000 },
];

const billing = () => createInvoiceService({ prisma: db(), queue: { enqueueEmail: async () => undefined }, appUrl: "https://app.example.com" });

async function document(): Promise<InvoiceDocumentData> {
  const client = await createClientCompany("Lagune Hôtel");
  await db().client.update({ where: { id: client.id }, data: { address: "Cocody, Abidjan", taxId: "1234567A" } });
  const actor = await createUser({ role: "ADMIN" });
  const id = await billing().createDraft({ clientId: client.id, lines }, actor.id);
  await billing().issue(id, actor.id);
  return (await loadInvoiceDocument(db(), id))!;
}

beforeEach(async () => {
  await resetDatabase();
  actAs(null);
});
afterAll(shutdown);

describe("invoice view", () => {
  it("shows the amounts, the VAT and the client in French", async () => {
    const view = buildInvoiceView(await document());
    expect(view).toMatchObject({ title: "FACTURE", watermark: null, creditNoteLine: null });
    expect(view.number).toMatch(/^\d{4}-001$/);
    expect(view.rows).toEqual([
      { label: "Audit financier", quantity: "1", unitPrice: "500 000 FCFA", total: "500 000 FCFA" },
      { label: "Formation", quantity: "1,5", unitPrice: "200 000 FCFA", total: "300 000 FCFA" },
    ]);
    expect(view.totals).toEqual([
      { label: "Total HT", value: "800 000 FCFA" },
      { label: "TVA (18 %)", value: "144 000 FCFA" },
      { label: "Total TTC", value: "944 000 FCFA", strong: true },
    ]);
    expect(view.client).toEqual({ name: "Lagune Hôtel", lines: ["Cocody, Abidjan", "NCC : 1234567A"] });
    expect(view.meta.map((m) => m.label)).toEqual(["Date d'émission", "Échéance"]);
  });

  it("shows the FNE number once recorded, and still says it is not the normalised invoice", async () => {
    const data = await document();
    expect(buildInvoiceView(data).fneLine).toBeNull();
    const withFne = buildInvoiceView({ ...data, fneNumber: "FNE-2026-0042" });
    expect(withFne.fneLine).toBe("N° FNE : FNE-2026-0042");
    for (const view of [buildInvoiceView(data), withFne]) {
      expect(view.notice).toBe(NOT_NORMALISED_NOTICE);
      expect(view.notice).toMatch(/ne constitue pas une facture normalisée/);
    }
  });

  it("marks drafts and cancelled invoices with a watermark", async () => {
    const data = await document();
    expect(buildInvoiceView({ ...data, status: "BROUILLON", number: null }).watermark).toBe("BROUILLON");
    expect(buildInvoiceView({ ...data, status: "BROUILLON", number: null }).number).toBe("Brouillon (non numérotée)");
    expect(buildInvoiceView({ ...data, status: "ANNULEE" }).watermark).toBe("ANNULÉE");
  });

  it("shows what is left to pay after a partial payment", async () => {
    const data = await document();
    const view = buildInvoiceView({ ...data, amountPaid: 400_000 });
    expect(view.totals.slice(-2)).toEqual([
      { label: "Déjà réglé", value: "400 000 FCFA" },
      { label: "Reste à payer", value: "544 000 FCFA", strong: true },
    ]);
  });

  it("presents a credit note as such, without payment details or due date", async () => {
    const data = await document();
    const view = buildInvoiceView({ ...data, isCreditNote: true, creditNoteOfNumber: "2026-001", totalHt: -800_000, totalVat: -144_000, totalTtc: -944_000 });
    expect(view.title).toBe("AVOIR");
    expect(view.creditNoteLine).toBe("Annule la facture n° 2026-001");
    expect(view.paymentLines).toEqual([]);
    expect(view.meta.map((m) => m.label)).toEqual(["Date d'émission"]);
    expect(view.totals[2]!.value).toBe("-944 000 FCFA");
  });

  it("prints the bank details and legal mentions of the settings", async () => {
    await db().setting.create({ data: { key: "cabinet", value: { bankDetails: "IBAN CI93 0000", invoiceMentions: "Paiement à 30 jours" } } });
    expect(buildInvoiceView((await document())).paymentLines).toEqual(["IBAN CI93 0000", "Paiement à 30 jours"]);
  });
});

describe("PDF rendering", () => {
  it("produces a real PDF", async () => {
    const pdf = await renderInvoicePdf(await document());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("renders drafts, credit notes and long invoices without failing", async () => {
    const data = await document();
    await renderInvoicePdf({ ...data, status: "BROUILLON", number: null });
    await renderInvoicePdf({ ...data, isCreditNote: true, creditNoteOfNumber: "2026-001", totalTtc: -1 });
    const many = Array.from({ length: 60 }, (_, i) => ({ position: i + 1, label: `Prestation ${i + 1} avec un libellé assez long pour passer à la ligne dans le tableau`, quantity: 100, unitPrice: 1000, total: 1000 }));
    const pdf = await renderInvoicePdf({ ...data, lines: many });
    expect(pdf.length).toBeGreaterThan(3000);
  });
});

describe("GET /api/invoices/:id/pdf", () => {
  const call = (id: string) => GET(new Request(`https://app.example.com/api/invoices/${id}/pdf`), { params: Promise.resolve({ id }) });

  async function setup() {
    const clientA = await createClientCompany("Client A");
    const clientB = await createClientCompany("Client B");
    const admin = await createUser({ role: "ADMIN" });
    const userA = await createUser({ role: "CLIENT", clientId: clientA.id });
    const userB = await createUser({ role: "CLIENT", clientId: clientB.id });
    const issue = async (clientId: string) => {
      const id = await billing().createDraft({ clientId, lines }, admin.id);
      await billing().issue(id, admin.id);
      return id;
    };
    const invoiceA = await issue(clientA.id);
    const invoiceB = await issue(clientB.id);
    const draftA = await billing().createDraft({ clientId: clientA.id, lines }, admin.id);
    return { admin, userA, userB, invoiceA, invoiceB, draftA, clientA };
  }

  async function asAdmin(adminId: string, email: string) {
    const { cookie } = await login(email);
    await db().user.update({ where: { id: adminId }, data: { twoFactorEnabled: true } });
    actAs(cookie);
  }

  it("lets the admin download any invoice, draft included, as an attachment", async () => {
    const s = await setup();
    const admin = await db().user.findUniqueOrThrow({ where: { id: s.admin.id } });
    await asAdmin(admin.id, admin.email);

    const response = await call(s.invoiceA);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="Facture-\d{4}-001\.pdf"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const draft = await call(s.draftA);
    expect(draft.status).toBe(200);
    expect(draft.headers.get("content-disposition")).toMatch(/Brouillon-/);
  });

  it("names credit notes Avoir-…", async () => {
    const s = await setup();
    const admin = await db().user.findUniqueOrThrow({ where: { id: s.admin.id } });
    const { creditNoteId } = await billing().cancelWithCreditNote(s.invoiceA, "Erreur", s.admin.id);
    await asAdmin(admin.id, admin.email);
    expect((await call(creditNoteId)).headers.get("content-disposition")).toMatch(/Avoir-\d{4}-003/);
  });

  it("lets a client download their own issued invoice", async () => {
    const s = await setup();
    const user = await db().user.findUniqueOrThrow({ where: { id: s.userA.id } });
    actAs((await login(user.email)).cookie);
    expect((await call(s.invoiceA)).status).toBe(200);
  });

  it("answers 404 to a client asking for another client's invoice, or a draft", async () => {
    const s = await setup();
    const user = await db().user.findUniqueOrThrow({ where: { id: s.userA.id } });
    actAs((await login(user.email)).cookie);

    const other = await call(s.invoiceB);
    expect(other.status).toBe(404);
    const otherBody = await other.json();
    expect(otherBody).toEqual({ error: "NOT_FOUND" });
    expect((await call(s.draftA)).status).toBe(404);
    expect((await call("does-not-exist")).status).toBe(404);
    // Indistinguishable from an invoice that does not exist.
    expect(await (await call("does-not-exist")).json()).toEqual(otherBody);
  });

  it("refuses anonymous visitors and admins who have not enrolled 2FA", async () => {
    const s = await setup();
    expect((await call(s.invoiceA)).status).toBe(401);
    const admin = await db().user.findUniqueOrThrow({ where: { id: s.admin.id } });
    actAs((await login(admin.email)).cookie); // no 2FA yet
    expect((await call(s.invoiceA)).status).toBe(403);
  });
});
