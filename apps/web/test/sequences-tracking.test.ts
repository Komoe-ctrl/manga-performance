import { hmacHex, signToken } from "@manga/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as openRoute } from "@/app/api/t/o/[id]/route";
import { GET as clickRoute } from "@/app/api/t/c/[id]/route";
import { POST as webhookRoute } from "@/app/api/webhooks/email/route";
import { createAccountFlows } from "@/server/auth/account-flows";
import { createCrmService } from "@/server/crm/crm-service";
import { handleEmailWebhook, isAuthentic, processEmailEvents } from "@/server/marketing/email-webhook";
import { SequenceError, createSequencesService } from "@/server/marketing/sequences-service";
import { MemoryMailer, createUser, db, resetDatabase, shutdown } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => undefined }));

// Same secrets as the test environment (vitest.config.ts).
const TRACKING_SECRET = "d".repeat(40);
const WEBHOOK_SECRET = "test"; // BREVO_WEBHOOK_SECRET
let clock: Date;
let adminId: string;

const service = () => createSequencesService({ prisma: db(), now: () => clock });
const crm = () => createCrmService({ prisma: db(), flows: createAccountFlows({ prisma: db(), mailer: new MemoryMailer(), appUrl: "https://app.example.com" }), now: () => clock });

const input = (over: Record<string, unknown> = {}) => ({
  name: "Relance prospects",
  trigger: "manuel" as const,
  active: false,
  steps: [
    { order: 1, delayDays: 0, subject: "Bonjour {{prenom}}", body: "Bonjour {{prenom|cher client}},\n\nParlons de {{besoin}} chez {{entreprise}} ({{secteur}})." },
    { order: 2, delayDays: 3, subject: "Suite", body: "Un rappel." },
  ],
  ...over,
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SequenceError) return error;
    throw error;
  }
  throw new Error("expected a SequenceError");
};

async function prospect(over: Record<string, unknown> = {}) {
  const created = await crm().createProspect({ companyName: `Société ${Math.random().toString(36).slice(2, 8)}`, sector: "Services", email: `p${Math.random().toString(36).slice(2, 8)}@example.com`, source: "manuel", ...over }, adminId);
  return created;
}

beforeEach(async () => {
  await resetDatabase();
  await db().$executeRawUnsafe(`TRUNCATE TABLE "SequenceStep", "EmailSequence" CASCADE`);
  clock = new Date("2026-11-07T09:00:00Z");
  adminId = (await createUser({ role: "ADMIN" })).id;
});
afterAll(shutdown);

describe("sequence definition", () => {
  it("creates an inactive sequence with one empty step", async () => {
    const created = await service().create("  Bienvenue  ", adminId);
    expect(created).toMatchObject({ name: "Bienvenue", trigger: "manuel", active: false, steps: [{ order: 1, delayDays: 0, subject: "", body: "" }], stats: { enrolled: 0, sent: 0, opened: 0, clicked: 0, unsubscribed: 0 } });
    expect((await failure(service().create("  ", adminId))).code).toBe("INVALID");
  });

  it("saves steps, round-trips the text, and maps the trigger", async () => {
    const created = await service().create("Seq", adminId);
    const saved = await service().update(created.id, input({ trigger: "inscription_newsletter" }), adminId);
    expect(saved).toMatchObject({ name: "Relance prospects", trigger: "inscription_newsletter", active: false });
    expect(saved.steps.map((s) => [s.order, s.delayDays, s.subject])).toEqual([[1, 0, "Bonjour {{prenom}}"], [2, 3, "Suite"]]);
    expect(saved.steps[0]!.body).toBe("Bonjour {{prenom|cher client}},\n\nParlons de {{besoin}} chez {{entreprise}} ({{secteur}}).");
    expect((await service().get(created.id))?.steps).toEqual(saved.steps);
    expect(await service().get("nope")).toBeNull();
    expect((await service().list()).map((s) => s.id)).toEqual([created.id]);
  });

  it("renumbers the steps 1..n, whatever order the screen sent", async () => {
    const created = await service().create("Seq", adminId);
    const saved = await service().update(created.id, input({ steps: [{ order: 9, delayDays: 5, subject: "Troisième", body: "c" }, { order: 2, delayDays: 1, subject: "Premier", body: "a" }] }), adminId);
    expect(saved.steps.map((s) => [s.order, s.subject])).toEqual([[1, "Premier"], [2, "Troisième"]]);
  });

  it("refuses unknown variables, naming the step and the variable", async () => {
    const created = await service().create("Seq", adminId);
    const bad = await failure(service().update(created.id, input({ steps: [{ order: 1, delayDays: 0, subject: "Salut {{nom}}", body: "x" }] }), adminId));
    expect(bad.code).toBe("INVALID");
    expect(bad.message).toContain("{{nom}}");
    expect(bad.message).toContain("étape 1");
    expect(bad.message).toContain("{{prenom}}");
    const inBody = await failure(service().update(created.id, input({ steps: [{ order: 1, delayDays: 0, subject: "ok", body: "Votre {{telephone}}" }] }), adminId));
    expect(inBody.message).toContain("le contenu");
    expect(await db().sequenceStep.count({ where: { sequenceId: created.id } })).toBe(1); // untouched
  });

  it("refuses unfinished variables", async () => {
    const created = await service().create("Seq", adminId);
    expect((await failure(service().update(created.id, input({ steps: [{ order: 1, delayDays: 0, subject: "ok", body: "Bonjour {{prenom" }] }), adminId))).message).toMatch(/mal formée/);
  });

  it("only activates a sequence whose steps are all filled in", async () => {
    const created = await service().create("Seq", adminId);
    expect((await failure(service().update(created.id, input({ active: true, steps: [{ order: 1, delayDays: 0, subject: "", body: "x" }] }), adminId))).code).toBe("INVALID");
    expect((await service().update(created.id, input({ active: true }), adminId)).active).toBe(true);
  });

  it("reports an unknown sequence, and audits changes", async () => {
    expect((await failure(service().update("nope", input(), adminId))).code).toBe("NOT_FOUND");
    const created = await service().create("Seq", adminId);
    await service().update(created.id, input(), adminId);
    expect((await db().auditLog.findMany({ where: { entityId: created.id } })).map((l) => l.action).sort()).toEqual(["sequence.created", "sequence.updated"]);
  });
});

describe("enrolling a prospect", () => {
  async function ready() {
    const created = await service().create("Seq", adminId);
    return service().update(created.id, input({ active: true }), adminId);
  }

  it("schedules the first step by its own delay", async () => {
    const seq = await ready();
    await service().update(seq.id, input({ active: true, steps: [{ order: 1, delayDays: 2, subject: "s", body: "b" }] }), adminId);
    const p = await prospect();
    const { enrollmentId } = await service().enroll(seq.id, p.id, adminId);
    expect(await db().sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).toMatchObject({ status: "ACTIVE", currentStep: 0, nextSendAt: new Date(clock.getTime() + 2 * 86_400_000) });
    expect(await db().auditLog.count({ where: { action: "sequence.enrolled" } })).toBe(1);
  });

  it("refuses clients, lost prospects, missing emails, suppressed addresses and repeats", async () => {
    const seq = await ready();
    const client = await prospect({ status: "client" });
    expect((await failure(service().enroll(seq.id, client.id, adminId))).code).toBe("CANNOT_ENROLL");
    const lost = await prospect();
    await crm().updateProspectStatus(lost.id, "perdu", {}, adminId);
    expect((await failure(service().enroll(seq.id, lost.id, adminId))).code).toBe("CANNOT_ENROLL");
    const noEmail = await prospect({ email: undefined });
    expect((await failure(service().enroll(seq.id, noEmail.id, adminId))).message).toMatch(/pas d'adresse/);
    const excluded = await prospect({ email: "excluded@example.com" });
    await db().suppression.create({ data: { email: "EXCLUDED@example.com", reason: "UNSUBSCRIBED" } });
    expect((await failure(service().enroll(seq.id, excluded.id, adminId))).message).toMatch(/liste d'exclusion/);

    const ok = await prospect();
    await service().enroll(seq.id, ok.id, adminId);
    expect((await failure(service().enroll(seq.id, ok.id, adminId))).code).toBe("ALREADY_ENROLLED");
    expect((await failure(service().enroll("nope", ok.id, adminId))).code).toBe("NOT_FOUND");
    expect((await failure(service().enroll(seq.id, "nope", adminId))).code).toBe("NOT_FOUND");
  });

  it("does not enrol twice even after the first run completed or was stopped", async () => {
    const seq = await ready();
    const p = await prospect();
    const { enrollmentId } = await service().enroll(seq.id, p.id, adminId);
    await db().sequenceEnrollment.update({ where: { id: enrollmentId }, data: { status: "COMPLETED" } });
    expect((await failure(service().enroll(seq.id, p.id, adminId))).code).toBe("ALREADY_ENROLLED");
  });

  it("stops every active sequence as soon as the status is changed by hand", async () => {
    const seq = await ready();
    const p = await prospect();
    const { enrollmentId } = await service().enroll(seq.id, p.id, adminId);
    await crm().updateProspectStatus(p.id, "en_negociation", {}, adminId);
    expect(await db().sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).toMatchObject({ status: "STOPPED", nextSendAt: null });
  });

  it("stops them when the prospect becomes a client or is lost", async () => {
    const seq = await ready();
    const [a, b] = [await prospect(), await prospect()];
    await service().enroll(seq.id, a.id, adminId);
    await service().enroll(seq.id, b.id, adminId);
    await crm().updateProspectStatus(a.id, "client", {}, adminId);
    await crm().updateProspectStatus(b.id, "perdu", {}, adminId);
    expect((await db().sequenceEnrollment.findMany()).map((e) => e.status)).toEqual(["STOPPED", "STOPPED"]);
  });

  it("computes statistics per person, not per event", async () => {
    const seq = await ready();
    const [a, b] = [await prospect({ email: "a@example.com" }), await prospect({ email: "b@example.com" })];
    const first = (await service().enroll(seq.id, a.id, adminId)).enrollmentId;
    const second = (await service().enroll(seq.id, b.id, adminId)).enrollmentId;
    await db().emailEvent.createMany({
      data: [
        { messageId: "m1", enrollmentId: first, email: "a@example.com", type: "SENT", occurredAt: clock },
        { messageId: "m2", enrollmentId: second, email: "b@example.com", type: "SENT", occurredAt: clock },
        { messageId: "o1", enrollmentId: first, email: "a@example.com", type: "OPENED", occurredAt: clock },
        { messageId: "o2", enrollmentId: first, email: "a@example.com", type: "OPENED", occurredAt: clock },
        { messageId: "c1", enrollmentId: first, email: "a@example.com", type: "CLICKED", occurredAt: clock },
        { messageId: "x", enrollmentId: null, email: "z@example.com", type: "SENT", occurredAt: clock }, // not ours
      ],
    });
    await db().sequenceEnrollment.update({ where: { id: second }, data: { status: "UNSUBSCRIBED" } });
    expect((await service().get(seq.id))!.stats).toEqual({ enrolled: 2, sent: 2, opened: 1, clicked: 1, unsubscribed: 1 });
  });

  it("enrols into active newsletter sequences only, ignoring ineligible prospects", async () => {
    const created = await service().create("Seq", adminId);
    await service().update(created.id, input({ trigger: "inscription_newsletter", active: true }), adminId);
    const p = await prospect();
    expect(await service().enrollNewsletterSignup(p.id)).toBe(1);
    expect(await service().enrollNewsletterSignup(p.id)).toBe(0); // already enrolled
    expect(await service().enrollNewsletterSignup((await prospect({ status: "client" })).id)).toBe(0);
  });
});

describe("marketing settings", () => {
  it("defaults to 50 emails a day and persists changes, audited", async () => {
    expect(await service().getMarketingSettings()).toEqual({ dailyCap: 50 });
    expect(await service().saveMarketingSettings({ dailyCap: 120 }, adminId)).toEqual({ dailyCap: 120 });
    expect(await service().getMarketingSettings()).toEqual({ dailyCap: 120 });
    expect(await db().auditLog.count({ where: { action: "settings.marketing_updated" } })).toBe(1);
    expect((await failure(service().saveMarketingSettings({ dailyCap: -1 }, adminId))).code).toBe("INVALID");
    await db().setting.update({ where: { key: "marketing" }, data: { value: { dailyCap: "many" } } });
    expect(await service().getMarketingSettings()).toEqual({ dailyCap: 50 });
  });
});

describe("tracking", () => {
  async function enrolled() {
    const created = await service().create("Seq", adminId);
    const seq = await service().update(created.id, input({ active: true }), adminId);
    const p = await prospect({ email: "awa@example.com" });
    const { enrollmentId } = await service().enroll(seq.id, p.id, adminId);
    return { enrollmentId };
  }
  const open = (token: string) => openRoute(new Request("https://app.example.com/x"), { params: Promise.resolve({ id: token }) });
  const click = (token: string) => clickRoute(new Request("https://app.example.com/x"), { params: Promise.resolve({ id: token }) });

  it("counts an open from a genuine pixel and answers with a transparent GIF", async () => {
    const { enrollmentId } = await enrolled();
    const response = await open(signToken("open", { e: enrollmentId, s: 1 }, TRACKING_SECRET));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 6).toString()).toBe("GIF89a");
    expect(await db().emailEvent.findFirstOrThrow({ where: { type: "OPENED" } })).toMatchObject({ enrollmentId, email: "awa@example.com", meta: { step: 1 } });
  });

  it("answers the same GIF to a forged, foreign or broken pixel, and records nothing", async () => {
    const { enrollmentId } = await enrolled();
    const tokens = [
      signToken("open", { e: enrollmentId, s: 1 }, "x".repeat(40)),
      signToken("click", { e: enrollmentId, s: 1 }, TRACKING_SECRET), // another purpose
      signToken("open", { e: "no-such-enrollment", s: 1 }, TRACKING_SECRET),
      "garbage",
    ];
    for (const token of tokens) {
      const response = await open(token);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/gif");
    }
    expect(await db().emailEvent.count()).toBe(0);
  });

  it("records a click and redirects to the signed destination", async () => {
    const { enrollmentId } = await enrolled();
    const response = await click(signToken("click", { e: enrollmentId, s: 2, u: "https://example.com/offre?a=1" }, TRACKING_SECRET));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/offre?a=1");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await db().emailEvent.findFirstOrThrow({ where: { type: "CLICKED" } })).toMatchObject({ enrollmentId, meta: { step: 2, url: "https://example.com/offre?a=1" } });
  });

  it("can never be used as an open redirect", async () => {
    const { enrollmentId } = await enrolled();
    const genuine = signToken("click", { e: enrollmentId, s: 1, u: "https://example.com/ok" }, TRACKING_SECRET);
    const [body, signature] = genuine.split(".");
    const swapped = Buffer.from(JSON.stringify({ e: enrollmentId, s: 1, u: "https://evil.example/phish" })).toString("base64url");

    expect((await click(`${swapped}.${signature}`)).status).toBe(404); // payload changed, signature no longer matches
    expect((await click(signToken("click", { e: enrollmentId, s: 1, u: "https://evil.example" }, "y".repeat(40)))).status).toBe(404);
    expect((await click(signToken("open", { e: enrollmentId, s: 1, u: "https://example.com" }, TRACKING_SECRET))).status).toBe(404);
    // Even a correctly signed non-web destination is refused.
    for (const u of ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "//evil.example"]) {
      expect((await click(signToken("click", { e: enrollmentId, s: 1, u }, TRACKING_SECRET))).status).toBe(404);
    }
    expect((await click(`${body}.`)).status).toBe(404);
    expect(await db().emailEvent.count()).toBe(0);
  });

  it("still sends the visitor on when the enrolment no longer exists", async () => {
    const response = await click(signToken("click", { e: "gone", s: 1, u: "https://example.com/ok" }, TRACKING_SECRET));
    expect(response.status).toBe(302);
    expect(await db().emailEvent.count()).toBe(0);
  });
});

describe("provider webhook", () => {
  const send = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${WEBHOOK_SECRET}` }) =>
    webhookRoute(new Request("https://app.example.com/api/webhooks/email", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  async function sentMessage(email = "awa@example.com", messageId = "<m1@smtp.example>") {
    const created = await service().create("Seq", adminId);
    const seq = await service().update(created.id, input({ active: true }), adminId);
    const p = await prospect({ email });
    const { enrollmentId } = await service().enroll(seq.id, p.id, adminId);
    await db().emailEvent.create({ data: { messageId, enrollmentId, email, type: "SENT", occurredAt: clock } });
    return { enrollmentId, messageId };
  }

  describe("authentication", () => {
    const body = '{"event":"delivered"}';
    it("accepts the bearer secret or a valid HMAC of the body", () => {
      expect(isAuthentic(new Headers({ authorization: `Bearer ${WEBHOOK_SECRET}` }), body, WEBHOOK_SECRET)).toBe(true);
      expect(isAuthentic(new Headers({ authorization: `bearer   ${WEBHOOK_SECRET} ` }), body, WEBHOOK_SECRET)).toBe(true);
      expect(isAuthentic(new Headers({ "x-webhook-signature": hmacHex(body, WEBHOOK_SECRET) }), body, WEBHOOK_SECRET)).toBe(true);
      expect(isAuthentic(new Headers({ "x-webhook-signature": `sha256=${hmacHex(body, WEBHOOK_SECRET).toUpperCase()}` }), body, WEBHOOK_SECRET)).toBe(true);
    });
    it("refuses everything else", () => {
      expect(isAuthentic(new Headers(), body, WEBHOOK_SECRET)).toBe(false);
      expect(isAuthentic(new Headers({ authorization: "Bearer wrong" }), body, WEBHOOK_SECRET)).toBe(false);
      expect(isAuthentic(new Headers({ authorization: WEBHOOK_SECRET }), body, WEBHOOK_SECRET)).toBe(false);
      expect(isAuthentic(new Headers({ authorization: "Basic abc" }), body, WEBHOOK_SECRET)).toBe(false);
      expect(isAuthentic(new Headers({ "x-webhook-signature": hmacHex("other body", WEBHOOK_SECRET) }), body, WEBHOOK_SECRET)).toBe(false);
      expect(isAuthentic(new Headers({ "x-webhook-signature": hmacHex(body, "other-secret") }), body, WEBHOOK_SECRET)).toBe(false);
    });
  });

  it("answers 401 without a valid proof, and changes nothing", async () => {
    const { messageId } = await sentMessage();
    const event = { event: "hard_bounce", email: "awa@example.com", "message-id": messageId };
    for (const headers of [{}, { authorization: "Bearer nope" }, { "x-webhook-signature": "deadbeef" }] as Record<string, string>[]) {
      expect((await send(event, headers)).status).toBe(401);
    }
    expect(await db().suppression.count()).toBe(0);
    expect(await db().emailEvent.count({ where: { type: "BOUNCED" } })).toBe(0);
  });

  it("authenticates before parsing: a bad proof with a bad body is still 401", async () => {
    expect((await send("not json at all", {})).status).toBe(401);
    expect((await send("not json at all")).status).toBe(400);
  });

  it("refuses oversized bodies", async () => {
    expect((await send("x".repeat(1_100_000))).status).toBe(413);
  });

  it("records a delivery against the enrolment it belongs to", async () => {
    const { enrollmentId, messageId } = await sentMessage();
    const response = await send({ event: "delivered", email: "Awa@Example.com", "message-id": messageId, ts_event: 1_794_042_000 });
    expect(await response.json()).toEqual({ ok: true, recorded: 1, suppressed: 0, ignored: 0 });
    expect(await db().emailEvent.findFirstOrThrow({ where: { type: "DELIVERED" } })).toMatchObject({
      messageId, enrollmentId, email: "awa@example.com", occurredAt: new Date(1_794_042_000 * 1000),
    });
  });

  it.each([
    ["hard_bounce", "HARD_BOUNCE", "BOUNCED", "BOUNCED"],
    ["invalid_email", "HARD_BOUNCE", "BOUNCED", "BOUNCED"],
    ["blocked", "HARD_BOUNCE", "BOUNCED", "BOUNCED"],
    ["spam", "COMPLAINT", "COMPLAINED", "BOUNCED"],
    ["unsubscribe", "UNSUBSCRIBED", "UNSUBSCRIBED", "UNSUBSCRIBED"],
    ["unsubscribed", "UNSUBSCRIBED", "UNSUBSCRIBED", "UNSUBSCRIBED"],
  ])("%s puts the address on the suppression list (%s) and stops its sequences", async (event, reason, eventType, enrollmentStatus) => {
    const { enrollmentId, messageId } = await sentMessage();
    await send({ event, email: "awa@example.com", "message-id": messageId });
    expect(await db().suppression.findUniqueOrThrow({ where: { email: "awa@example.com" } })).toMatchObject({ reason });
    expect(await db().emailEvent.count({ where: { type: eventType, enrollmentId } })).toBe(1);
    expect(await db().sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).toMatchObject({ status: enrollmentStatus, nextSendAt: null });
  });

  it("records a soft bounce without excluding the address", async () => {
    const { enrollmentId, messageId } = await sentMessage();
    await send({ event: "soft_bounce", email: "awa@example.com", "message-id": messageId });
    expect(await db().suppression.count()).toBe(0);
    expect(await db().emailEvent.count({ where: { type: "BOUNCED" } })).toBe(1);
    expect((await db().sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe("ACTIVE");
  });

  it("is safe to receive twice", async () => {
    const { messageId } = await sentMessage();
    const event = { event: "hard_bounce", email: "awa@example.com", "message-id": messageId };
    await send(event);
    const again = await send([event, event]);
    expect(await again.json()).toMatchObject({ recorded: 0 });
    expect(await db().emailEvent.count({ where: { type: "BOUNCED" } })).toBe(1);
    expect(await db().suppression.count()).toBe(1);
  });

  it("accepts batches, ignores events it does not handle, and still suppresses without a message id", async () => {
    await sentMessage("a@example.com", "<a@x>");
    const response = await send([
      { event: "delivered", email: "a@example.com", "message-id": "<a@x>" },
      { event: "opened", email: "a@example.com", "message-id": "<a@x>" },
      { event: "click", email: "a@example.com" },
      { email: "no-event@example.com" },
      { event: "delivered" },
      "garbage",
      { event: "spam", email: "complainer@example.com" },
    ]);
    expect(await response.json()).toEqual({ ok: true, recorded: 1, suppressed: 1, ignored: 4 });
    expect(await db().suppression.findUniqueOrThrow({ where: { email: "complainer@example.com" } })).toMatchObject({ reason: "COMPLAINT" });
  });

  it("keeps the first reason when an address is already suppressed", async () => {
    await db().suppression.create({ data: { email: "awa@example.com", reason: "HARD_BOUNCE" } });
    await send({ event: "unsubscribe", email: "awa@example.com", "message-id": "<z>" });
    expect((await db().suppression.findUniqueOrThrow({ where: { email: "awa@example.com" } })).reason).toBe("HARD_BOUNCE");
  });

  it("asks the provider to retry on a server failure, without leaking details", async () => {
    const broken = { emailEvent: { findFirst: async () => { throw new Error("db password hunter2"); } }, suppression: { upsert: async () => undefined }, sequenceEnrollment: { updateMany: async () => ({ count: 0 }) }, newsletterSubscriber: { updateMany: async () => ({ count: 0 }) } };
    const response = await handleEmailWebhook(
      new Request("https://app.example.com/api/webhooks/email", { method: "POST", headers: { authorization: `Bearer ${WEBHOOK_SECRET}` }, body: JSON.stringify({ event: "delivered", email: "a@b.ci", "message-id": "<x>" }) }),
      { prisma: broken as never, secret: WEBHOOK_SECRET },
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });

  it("applies events directly too", async () => {
    expect(await processEmailEvents(db(), [{ event: "delivered", email: "x@y.ci", "message-id": "<q>" }])).toEqual({ recorded: 1, suppressed: 0, ignored: 0 });
  });
});
