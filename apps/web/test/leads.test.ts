import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountFlows } from "@/server/auth/account-flows";
import { createCrmService } from "@/server/crm/crm-service";
import type { ConsultantNotifier, NewLeadNotice } from "@/server/email/consultant-notifier";
import { handleLeadRequest } from "@/server/leads/handle-lead";
import { MemoryMailer, db, resetDatabase, shutdown } from "./helpers";

class MemoryNotifier implements ConsultantNotifier {
  notices: NewLeadNotice[] = [];
  fail = false;
  async notifyNewLead(notice: NewLeadNotice) {
    if (this.fail) throw new Error("smtp down");
    this.notices.push(notice);
  }
}

let notifier: MemoryNotifier;
const verifyHuman = vi.fn(async ({ token }: { token: string | undefined }) => token === "valid-token");

const env = {
  TURNSTILE_SECRET_KEY: "secret",
  ADMIN_NOTIFICATION_EMAIL: "admin@example.com",
  APP_URL: "https://app.example.com",
};

function post(body: unknown, options: { ip?: string; contentType?: string | null; raw?: string } = {}) {
  const headers = new Headers({ "x-forwarded-for": options.ip ?? "198.51.100.1" });
  if (options.contentType !== null) headers.set("content-type", options.contentType ?? "application/json");
  const request = new Request("https://app.example.com/api/leads", {
    method: "POST",
    headers,
    body: options.raw ?? JSON.stringify(body),
  });
  const crm = createCrmService({
    prisma: db(),
    flows: createAccountFlows({ prisma: db(), mailer: new MemoryMailer(), appUrl: env.APP_URL }),
  });
  return handleLeadRequest(request, { crm, notifier, env, verifyHuman });
}

const contact = {
  source: "site_formulaire",
  name: "Awa Koné",
  email: "awa@lagune.ci",
  phone: "07 01 02 03 04",
  company: "Lagune Hôtel SARL",
  sector: "Hôtellerie",
  need: "audit",
  message: "Nous souhaitons un audit de nos coûts.",
  consent: true,
  turnstileToken: "valid-token",
};

beforeEach(async () => {
  await resetDatabase();
  notifier = new MemoryNotifier();
  verifyHuman.mockClear();
});
afterAll(shutdown);

describe("input checks", () => {
  it("only accepts JSON", async () => {
    expect((await post(contact, { contentType: "text/plain" })).status).toBe(415);
    expect((await post(contact, { contentType: null })).status).toBe(415);
  });

  it("rejects malformed and oversized bodies", async () => {
    expect((await post(null, { raw: "{not json" })).status).toBe(400);
    expect((await post({ ...contact, message: "x".repeat(30_000) })).status).toBe(413);
  });

  it("rejects unknown fields, bad values and missing consent", async () => {
    const { consent: _omit, ...withoutConsent } = contact;
    const bad = [
      { ...contact, role: "ADMIN" },
      { ...contact, source: "scraper" },
      { ...contact, email: "not-an-email" },
      { ...contact, name: "A" },
      { ...contact, consent: false },
      withoutConsent,
    ];
    // One IP per request: this test is about validation, not about the rate limit.
    for (const [index, body] of bad.entries()) {
      expect((await post(body, { ip: `192.0.2.${index}` })).status).toBe(400);
    }
    expect(await db().prospect.count()).toBe(0);
  });

  it("requires an email for forms and the demo, and email or phone for the chatbot", async () => {
    const { email: _email, ...noEmail } = contact;
    expect((await post(noEmail)).status).toBe(400);
    expect((await post({ ...noEmail, source: "demo" })).status).toBe(400);

    const chatbot = { ...noEmail, source: "chatbot" };
    expect((await post(chatbot)).status).toBe(200);
    const { phone: _phone, ...noContact } = chatbot;
    expect((await post(noContact, { ip: "198.51.100.2" })).status).toBe(400);
  });

  it("rejects an invalid phone number", async () => {
    expect((await post({ ...contact, phone: "12" })).status).toBe(400);
    expect(await db().prospect.count()).toBe(0);
  });

  it("never leaks validation details", async () => {
    const response = await post({ ...contact, email: "nope" });
    expect(await response.json()).toEqual({ ok: false, error: "Les informations saisies sont invalides." });
  });
});

describe("anti-spam", () => {
  it("refuses a missing or invalid Turnstile token and stores nothing", async () => {
    const { turnstileToken: _t, ...noToken } = contact;
    expect((await post(noToken)).status).toBe(400);
    expect((await post({ ...contact, turnstileToken: "forged" }, { ip: "198.51.100.3" })).status).toBe(400);
    expect(await db().prospect.count()).toBe(0);
    expect(notifier.notices).toHaveLength(0);
  });

  it("silently drops honeypot submissions, without storing, notifying or verifying", async () => {
    const response = await post({ ...contact, website: "http://spam.example" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await db().prospect.count()).toBe(0);
    expect(notifier.notices).toHaveLength(0);
    expect(verifyHuman).not.toHaveBeenCalled();
  });

  it("limits each IP to 5 requests per hour", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post({ ...contact, email: `p${i}@x.ci`, company: `Entreprise ${i}${"abcde"[i]}` })).status).toBe(200);
    }
    const blocked = await post({ ...contact, email: "late@x.ci" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another visitor is unaffected.
    expect((await post(contact, { ip: "203.0.113.77" })).status).toBe(200);
  });

  it("counts invalid attempts against the limit too", async () => {
    for (let i = 0; i < 5; i++) await post({ nonsense: true });
    expect((await post(contact)).status).toBe(429);
  });
});

describe("new lead", () => {
  it("creates the prospect with consent, follow-ups and an audit entry", async () => {
    const response = await post(contact);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const prospect = await db().prospect.findFirstOrThrow();
    expect(prospect).toMatchObject({
      companyName: "Lagune Hôtel SARL",
      companyNameNorm: "lagune hotel",
      contactName: "Awa Koné",
      email: "awa@lagune.ci",
      phone: "+2250701020304",
      sector: "Hôtellerie",
      need: "AUDIT",
      source: "SITE_FORMULAIRE",
      status: "NOUVEAU",
      consentSource: "lead:site_formulaire",
      notes: "Nous souhaitons un audit de nos coûts.",
    });
    expect(prospect.consentAt).toBeInstanceOf(Date);
    expect((await db().followUp.findMany({ where: { prospectId: prospect.id } })).map((f) => f.rule).sort()).toEqual(["J+15", "J+7"]);
    expect(await db().auditLog.findFirstOrThrow({ where: { entityId: prospect.id } })).toMatchObject({
      action: "prospect.created",
      actorId: null,
    });
  });

  it("stores demo leads with their own source and defaults the company to the name", async () => {
    await post({ ...contact, source: "demo", company: undefined, sector: undefined });
    expect(await db().prospect.findFirstOrThrow()).toMatchObject({
      source: "DEMO",
      companyName: "Awa Koné",
      sector: "Non précisé",
    });
  });

  it("asks for the consultant to be notified", async () => {
    await post(contact);
    const prospect = await db().prospect.findFirstOrThrow();
    expect(notifier.notices).toEqual([
      {
        to: "admin@example.com",
        prospectId: prospect.id,
        returning: false,
        sourceLabel: "le formulaire de contact",
        companyName: "Lagune Hôtel SARL",
        contactName: "Awa Koné",
        appUrl: "https://app.example.com",
      },
    ]);
  });

  it("still succeeds when the notification fails", async () => {
    notifier.fail = true;
    expect((await post(contact)).status).toBe(200);
    expect(await db().prospect.count()).toBe(1);
  });
});

describe("existing contacts", () => {
  beforeEach(async () => {
    await post(contact, { ip: "10.1.1.1" });
    notifier.notices = [];
  });

  async function expectNoDuplicate(body: Record<string, unknown>) {
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true }); // identical to a first contact
    expect(await db().prospect.count()).toBe(1);
  }

  it("adds a note instead of a duplicate when the email matches", async () => {
    await expectNoDuplicate({ ...contact, company: "Autre", phone: undefined, email: "AWA@lagune.ci", source: "chatbot", message: "Rappel svp" });
    const note = await db().interaction.findFirstOrThrow();
    expect(note).toMatchObject({ type: "NOTE", createdBy: "system" });
    expect(note.summary).toBe("Nouveau contact via le chatbot.\nRappel svp");
  });

  it("matches the same phone written differently", async () => {
    await expectNoDuplicate({ ...contact, company: "Autre", email: "other@x.ci", phone: "+225 0701020304" });
  });

  it("matches a very similar company name", async () => {
    await expectNoDuplicate({ ...contact, company: "LAGUNE HOTELS S.A.", email: "other@x.ci", phone: undefined });
  });

  it("does not schedule new follow-ups or create a new prospect, but notifies as returning", async () => {
    await expectNoDuplicate(contact);
    expect(await db().followUp.count()).toBe(2);
    expect(notifier.notices).toMatchObject([{ returning: true }]);
  });

  it("records consent on a prospect that had none, and keeps an existing one", async () => {
    await db().prospect.updateMany({ data: { consentAt: null, consentSource: null } });
    await expectNoDuplicate(contact);
    const first = await db().prospect.findFirstOrThrow();
    expect(first.consentSource).toBe("lead:site_formulaire");

    await post({ ...contact, source: "chatbot" });
    expect((await db().prospect.findFirstOrThrow()).consentSource).toBe("lead:site_formulaire");
  });

  it("ignores soft-deleted prospects", async () => {
    await db().prospect.updateMany({ data: { deletedAt: new Date() } });
    await post(contact);
    expect(await db().prospect.count({ where: { deletedAt: null } })).toBe(1);
    expect(await db().prospect.count()).toBe(2);
  });
});
