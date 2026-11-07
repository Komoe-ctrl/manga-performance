import { hashedSuppressionKey, isSuppressed } from "@manga/db/marketing";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/server/actions/privacy";
import { createInvoiceService } from "@/server/billing/invoice-service";
import { ANONYMIZED_NAME, createPrivacyService } from "@/server/privacy/privacy-service";
import { MemoryStorage } from "./memory-storage";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});

const NOW = new Date("2026-11-07T10:00:00Z");
const storage = new MemoryStorage();
const privacy = () => createPrivacyService({ prisma: db(), storage, now: () => NOW });

beforeEach(async () => {
  await resetDatabase();
  storage.objects.clear();
  storage.deleted = [];
  actAs(null);
});
afterAll(shutdown);

/** A converted client with a portal user, history, an invoice, a message with a file, and newsletter data. */
async function fullContact() {
  const admin = await createUser({ role: "ADMIN" });
  const prospect = await db().prospect.create({
    data: {
      companyName: "Lagune Hôtel",
      companyNameNorm: "lagune hotel",
      contactName: "Awa Koné",
      email: "awa@lagune.example",
      phone: "+2250701020304",
      city: "Abidjan",
      sector: "Hôtellerie",
      source: "SITE_FORMULAIRE",
      status: "CLIENT",
      notes: "Cliente exigeante",
      consentAt: NOW,
      consentSource: "lead:site_formulaire",
    },
  });
  await db().interaction.create({ data: { prospectId: prospect.id, type: "NOTE", summary: "Appel avec Awa au 0701020304", occurredAt: NOW, createdBy: admin.id } });
  await db().followUp.create({ data: { prospectId: prospect.id, rule: "J+7", dueAt: new Date("2026-12-01T08:00:00Z"), note: "rappeler Awa" } });
  const sequence = await db().emailSequence.create({ data: { name: "Bienvenue", trigger: "MANUAL", active: true } });
  await db().sequenceEnrollment.create({ data: { sequenceId: sequence.id, prospectId: prospect.id, status: "ACTIVE", nextSendAt: NOW } });

  const client = await db().client.create({ data: { prospectId: prospect.id, legalName: "Lagune Hôtel SARL", address: "Cocody", taxId: "1234567A" } });
  const portal = await createUser({ role: "CLIENT", clientId: client.id, email: "awa@lagune.example" });
  await login(portal.email);

  const billing = createInvoiceService({ prisma: db(), queue: { enqueueEmail: async () => undefined }, appUrl: "https://app.example.com" });
  const invoiceId = await billing.createDraft({ clientId: client.id, lines: [{ label: "Audit", quantity: 100, unitPrice: 500_000 }] }, admin.id);
  await billing.issue(invoiceId, admin.id);

  storage.put("messages/a.pdf", "%PDF-1.7");
  await db().message.create({
    data: { clientId: client.id, authorId: portal.id, fromRole: "CLIENT", body: "Bonjour, mon numéro est 0701020304", attachmentKey: "messages/a.pdf", attachmentName: "contrat.pdf", attachmentMime: "application/pdf", attachmentSize: 8 },
  });
  await db().notification.create({ data: { userId: portal.id, type: "NEW_MESSAGE", payload: { from: "Awa" } } });
  await db().newsletterSubscriber.create({ data: { email: "awa@lagune.example", confirmedAt: NOW, consentIp: "203.0.113.9" } });
  await db().emailEvent.create({ data: { messageId: "m1", email: "awa@lagune.example", type: "OPENED", occurredAt: NOW, meta: { ua: "Mozilla" } } });
  await db().suppression.create({ data: { email: "awa@lagune.example", reason: "UNSUBSCRIBED" } });
  const job = await db().scrapeJob.create({ data: { source: "ANNUAIRE", filters: {}, status: "DONE", createdBy: admin.id } });
  await db().scrapeResult.create({ data: { jobId: job.id, companyName: "Lagune", companyNameNorm: "lagune", email: "awa@lagune.example", sourceUrl: "http://x.test", collectedAt: NOW } });
  return { admin, prospect, client, portal, invoiceId };
}

describe("export of a contact's data", () => {
  it("contains everything held about the contact", async () => {
    const { admin, prospect } = await fullContact();
    const data = await privacy().exportContact(prospect.id, admin.id);

    expect(data.contact).toMatchObject({ contactName: "Awa Koné", email: "awa@lagune.example", phone: "+2250701020304", consent: { source: "lead:site_formulaire" } });
    expect(data.interactions).toHaveLength(1);
    expect(data.followUps).toHaveLength(1);
    expect(data.emailSequences).toEqual([expect.objectContaining({ sequence: "Bienvenue", status: "ACTIVE" })]);
    expect(data.emailEvents).toEqual([expect.objectContaining({ type: "OPENED" })]);
    expect(data.newsletter).toMatchObject({ confirmedAt: NOW.toISOString() });
    expect(data.suppressionList).toMatchObject({ reason: "UNSUBSCRIBED" });
    expect(data.collectedByScraper).toHaveLength(1);
    expect(data.client).toMatchObject({ legalName: "Lagune Hôtel SARL", taxId: "1234567A" });
    expect(data.client!.portalUsers).toHaveLength(1);
    expect(data.client!.invoices).toHaveLength(1);
    expect(data.client!.messages).toEqual([expect.objectContaining({ body: "Bonjour, mon numéro est 0701020304", attachmentName: "contrat.pdf" })]);
  });

  it("never exports secrets or the IP address", async () => {
    const { admin, prospect } = await fullContact();
    const text = JSON.stringify(await privacy().exportContact(prospect.id, admin.id));
    expect(text).not.toContain("203.0.113.9");
    expect(text).not.toMatch(/argon2|"password"|secret|token/i);
  });

  it("is journaled, without personal data", async () => {
    const { admin, prospect } = await fullContact();
    await privacy().exportContact(prospect.id, admin.id);
    const entry = await db().auditLog.findFirstOrThrow({ where: { action: "privacy.exported" } });
    expect(entry).toMatchObject({ actorId: admin.id, entity: "Prospect", entityId: prospect.id });
    expect(JSON.stringify(entry)).not.toContain("awa@");
  });

  it("answers NOT_FOUND for an unknown contact", async () => {
    await expect(privacy().exportContact("nope", "a")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("anonymization", () => {
  it("erases the personal data and keeps the invoices", async () => {
    const { admin, prospect, client, portal, invoiceId } = await fullContact();
    const result = await privacy().anonymizeContact(prospect.id, admin.id);
    expect(result).toMatchObject({ portalUsers: 1, messages: 1, filesDeleted: 1, invoicesKept: 1 });

    const after = await db().prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(after).toMatchObject({ companyName: ANONYMIZED_NAME, contactName: null, email: null, phone: null, city: null, notes: null, consentAt: null });
    expect(after.deletedAt).not.toBeNull();

    expect((await db().interaction.findFirstOrThrow({ where: { prospectId: prospect.id } })).summary).toBe("[supprimé]");
    expect((await db().followUp.findFirstOrThrow({ where: { prospectId: prospect.id } })).note).toBeNull();
    expect((await db().sequenceEnrollment.findFirstOrThrow({ where: { prospectId: prospect.id } })).status).toBe("STOPPED");

    // Invoice and the legal identity of the client company are untouched.
    const invoice = await db().invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice).toMatchObject({ clientId: client.id, totalTtc: 590_000, status: "EMISE" });
    expect(await db().client.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ legalName: "Lagune Hôtel SARL", taxId: "1234567A" });

    // No trace of the address or phone number remains.
    const dump = JSON.stringify({
      users: await db().user.findMany(),
      messages: await db().message.findMany(),
      events: await db().emailEvent.findMany(),
      scraped: await db().scrapeResult.findMany(),
      prospects: await db().prospect.findMany(),
      interactions: await db().interaction.findMany(),
    });
    expect(dump).not.toContain("awa@lagune.example");
    expect(dump).not.toContain("0701020304");
    expect(dump).not.toContain("Awa");

    expect(await db().newsletterSubscriber.count()).toBe(0);
    expect(await db().session.count({ where: { userId: portal.id } })).toBe(0);
    expect(await db().account.count({ where: { userId: portal.id } })).toBe(0);
    expect(await db().notification.count({ where: { userId: portal.id } })).toBe(0);
    expect(await db().user.findUniqueOrThrow({ where: { id: portal.id } })).toMatchObject({ disabledAt: NOW, name: "Utilisateur anonymisé" });
    expect(storage.deleted).toEqual(["messages/a.pdf"]);
    expect(await db().emailEvent.count()).toBe(1);
  });

  it("keeps the person excluded, as a hash of the address and never the address itself", async () => {
    const { admin, prospect } = await fullContact();
    await privacy().anonymizeContact(prospect.id, admin.id);
    expect(await db().suppression.count({ where: { email: "awa@lagune.example" } })).toBe(0);
    const rows = await db().suppression.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: hashedSuppressionKey("Awa@Lagune.example"), reason: "UNSUBSCRIBED" });
    expect(JSON.stringify(rows)).not.toContain("lagune");
    // The marketing guard still refuses this address, whatever its case.
    expect(await isSuppressed(db(), "AWA@lagune.example")).toBe("UNSUBSCRIBED");
    expect(await isSuppressed(db(), "someone-else@example.com")).toBeNull();
  });

  it("is journaled with counts only", async () => {
    const { admin, prospect } = await fullContact();
    await privacy().anonymizeContact(prospect.id, admin.id);
    const entry = await db().auditLog.findFirstOrThrow({ where: { action: "privacy.anonymized" } });
    expect(entry.actorId).toBe(admin.id);
    expect(entry.diff).toMatchObject({ messages: 1, portalUsers: 1 });
    expect(JSON.stringify(entry)).not.toMatch(/awa|lagune/i);
  });

  it("cannot be done twice, nor exported afterwards", async () => {
    const { admin, prospect } = await fullContact();
    await privacy().anonymizeContact(prospect.id, admin.id);
    await expect(privacy().anonymizeContact(prospect.id, admin.id)).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
    await expect(privacy().exportContact(prospect.id, admin.id)).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
  });

  it("works for a simple prospect without a client space", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const prospect = await db().prospect.create({
      data: { companyName: "Petit", companyNameNorm: "petit", email: "p@example.com", sector: "Commerce", source: "CHATBOT" },
    });
    expect(await privacy().anonymizeContact(prospect.id, admin.id)).toMatchObject({ portalUsers: 0, invoicesKept: 0, filesDeleted: 0 });
  });

  it("does not touch another contact", async () => {
    const { admin, prospect } = await fullContact();
    const other = await db().prospect.create({
      data: { companyName: "Autre", companyNameNorm: "autre", email: "autre@example.com", sector: "BTP", source: "MANUEL" },
    });
    await privacy().anonymizeContact(prospect.id, admin.id);
    expect(await db().prospect.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ companyName: "Autre", email: "autre@example.com", deletedAt: null });
  });

  it("still succeeds if the storage cannot delete a file", async () => {
    const { admin, prospect } = await fullContact();
    const failing = createPrivacyService({
      prisma: db(),
      storage: { delete: async () => { throw new Error("storage down"); } },
      now: () => NOW,
    });
    expect(await failing.anonymizeContact(prospect.id, admin.id)).toMatchObject({ filesDeleted: 0 });
    expect((await db().prospect.findUniqueOrThrow({ where: { id: prospect.id } })).companyName).toBe(ANONYMIZED_NAME);
  });
});

describe("privacy actions", () => {
  const all: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
    ["exportContactData", () => actions.exportContactDataAction("x")],
    ["anonymizeContact", () => actions.anonymizeContactAction({ id: "x", confirm: true })],
  ];

  it.each(all)("%s refuses anonymous visitors", async (_name, call) => {
    expect(await call()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(all)("%s refuses a client", async (_name, call) => {
    const company = await createClientCompany("Acme");
    const user = await createUser({ role: "CLIENT", clientId: company.id });
    actAs((await login(user.email)).cookie);
    expect(await call()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("requires an explicit confirmation to anonymize", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { cookie } = await login(admin.email);
    await db().user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
    actAs(cookie);
    const prospect = await db().prospect.create({ data: { companyName: "Petit", companyNameNorm: "petit", sector: "Commerce", source: "MANUEL" } });

    expect(await actions.anonymizeContactAction({ id: prospect.id })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.anonymizeContactAction({ id: prospect.id, confirm: false })).toMatchObject({ ok: false, code: "INVALID" });
    expect((await db().prospect.findUniqueOrThrow({ where: { id: prospect.id } })).companyName).toBe("Petit");

    expect(await actions.anonymizeContactAction({ id: prospect.id, confirm: true })).toMatchObject({ ok: true });
    expect(await actions.exportContactDataAction(prospect.id)).toMatchObject({ ok: false, code: "ALREADY_ANONYMIZED" });
  });
});
