import { signToken } from "@manga/core";
import type { EmailJob } from "@manga/emails";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as confirmRoute } from "@/app/api/newsletter/confirm/route";
import { createAccountFlows } from "@/server/auth/account-flows";
import { createCrmService } from "@/server/crm/crm-service";
import { createNewsletterService } from "@/server/marketing/newsletter-service";
import { handleSubscribe, handleUnsubscribe } from "@/server/marketing/newsletter-handlers";
import { createSequencesService } from "@/server/marketing/sequences-service";
import { MemoryMailer, createUser, db, resetDatabase, shutdown } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => undefined }));

const SECRET = "t".repeat(40);
let clock: Date;
let emails: EmailJob[];

const crm = () =>
  createCrmService({ prisma: db(), flows: createAccountFlows({ prisma: db(), mailer: new MemoryMailer(), appUrl: "https://app.example.com" }), now: () => clock });
const sequences = () => createSequencesService({ prisma: db(), now: () => clock });
const newsletter = () =>
  createNewsletterService({
    prisma: db(),
    queue: { enqueueEmail: async (job) => void emails.push(job) },
    crm: crm(),
    sequences: sequences(),
    appUrl: "https://app.example.com",
    now: () => clock,
  });

const tokenOf = (job: EmailJob) => {
  if (job.template !== "newsletter-confirmation") throw new Error("wrong template");
  return new URL(job.data.url).searchParams.get("token")!;
};

async function welcomeSequence(over: { active?: boolean; trigger?: "NEWSLETTER_SIGNUP" | "MANUAL" } = {}) {
  const created = await db().emailSequence.create({ data: { name: "Bienvenue", trigger: over.trigger ?? "NEWSLETTER_SIGNUP", active: over.active ?? true } });
  await db().sequenceStep.create({ data: { sequenceId: created.id, order: 1, delayDays: 0, subject: "Bienvenue", bodyJson: { type: "doc", content: [] } } });
  return created;
}

beforeEach(async () => {
  await resetDatabase();
  await db().$executeRawUnsafe(`TRUNCATE TABLE "SequenceStep", "EmailSequence" CASCADE`);
  clock = new Date("2026-11-07T09:00:00Z");
  emails = [];
});
afterAll(shutdown);

describe("subscribing", () => {
  it("stores a hashed token with a 48 hour expiry and sends the confirmation email", async () => {
    await newsletter().subscribe({ email: "  Awa@Lagune.CI ", ip: "203.0.113.5" });

    const row = await db().newsletterSubscriber.findUniqueOrThrow({ where: { email: "awa@lagune.ci" } });
    expect(row).toMatchObject({ confirmedAt: null, unsubscribedAt: null, consentIp: "203.0.113.5" });
    expect(row.confirmExpiresAt).toEqual(new Date(clock.getTime() + 48 * 3600_000));
    expect(row.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ template: "newsletter-confirmation", to: "awa@lagune.ci" });
    const token = tokenOf(emails[0]!);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(row)).not.toContain(token); // only the hash is stored
  });

  it("is not subscribed until the link is clicked", async () => {
    await newsletter().subscribe({ email: "awa@lagune.ci", ip: "unknown" });
    expect((await newsletter().listSubscribers())[0]).toMatchObject({ email: "awa@lagune.ci", confirmed: false });
    expect((await db().newsletterSubscriber.findFirstOrThrow()).consentIp).toBeNull();
    expect(await db().prospect.count()).toBe(0);
  });

  it("sends a fresh link to someone who has not confirmed yet, and the old one stops working", async () => {
    await newsletter().subscribe({ email: "awa@lagune.ci", ip: "1.1.1.1" });
    await newsletter().subscribe({ email: "awa@lagune.ci", ip: "1.1.1.1" });
    expect(emails).toHaveLength(2);
    expect(await db().newsletterSubscriber.count()).toBe(1);
    expect(await newsletter().confirm(tokenOf(emails[0]!))).toBe("invalid");
    expect(await newsletter().confirm(tokenOf(emails[1]!))).toBe("confirmed");
  });

  it("stays silent for someone already subscribed", async () => {
    await newsletter().subscribe({ email: "awa@lagune.ci", ip: "1.1.1.1" });
    await newsletter().confirm(tokenOf(emails[0]!));
    emails = [];
    await newsletter().subscribe({ email: "AWA@lagune.ci", ip: "1.1.1.1" });
    expect(emails).toHaveLength(0);
  });

  it.each(["HARD_BOUNCE", "COMPLAINT", "MANUAL"])("never emails an address excluded for %s", async (reason) => {
    await db().suppression.create({ data: { email: "awa@lagune.ci", reason } });
    await newsletter().subscribe({ email: "awa@lagune.ci", ip: "1.1.1.1" });
    expect(emails).toHaveLength(0);
    expect(await db().newsletterSubscriber.count()).toBe(0);
  });
});

describe("confirming", () => {
  async function pending(email = "awa@lagune.ci") {
    await newsletter().subscribe({ email, ip: "1.1.1.1" });
    return tokenOf(emails.at(-1)!);
  }

  it("activates the subscription, single use, and records the consent in the CRM", async () => {
    const token = await pending();
    expect(await newsletter().confirm(token)).toBe("confirmed");

    const row = await db().newsletterSubscriber.findFirstOrThrow();
    expect(row).toMatchObject({ confirmedAt: clock, confirmTokenHash: null, confirmExpiresAt: null });
    expect((await newsletter().listSubscribers())[0]).toMatchObject({ confirmed: true });

    const prospect = await db().prospect.findFirstOrThrow();
    expect(prospect).toMatchObject({ email: "awa@lagune.ci", source: "NEWSLETTER", consentSource: "lead:newsletter", companyName: "awa@lagune.ci", sector: "Non précisé" });
    expect(prospect.consentAt).toEqual(clock);
    expect(prospect.contactName).toBeNull();

    expect(await newsletter().confirm(token)).toBe("invalid"); // single use
  });

  it("links to an existing prospect instead of creating a duplicate", async () => {
    await crm().createProspect({ companyName: "Lagune Hôtel", sector: "Hôtellerie", email: "awa@lagune.ci", source: "manuel" }, (await createUser({ role: "ADMIN" })).id);
    await newsletter().confirm(await pending());
    expect(await db().prospect.count()).toBe(1);
    expect((await db().interaction.findFirstOrThrow()).summary).toBe("Nouveau contact via la newsletter.");
  });

  it("enrols the new prospect in active newsletter sequences only", async () => {
    const welcome = await welcomeSequence();
    await welcomeSequence({ active: false });
    await welcomeSequence({ trigger: "MANUAL" });
    await newsletter().confirm(await pending());

    const enrollments = await db().sequenceEnrollment.findMany();
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]).toMatchObject({ sequenceId: welcome.id, status: "ACTIVE", currentStep: 0, nextSendAt: clock });
  });

  it("does not enrol a client in marketing sequences", async () => {
    await welcomeSequence();
    const admin = await createUser({ role: "ADMIN" });
    const client = await crm().createProspect({ companyName: "Déjà client", sector: "x", email: "awa@lagune.ci", source: "manuel", status: "client" }, admin.id);
    await newsletter().confirm(await pending());
    expect(await db().sequenceEnrollment.count({ where: { prospectId: client.id } })).toBe(0);
  });

  it("refuses an expired link, and unknown or malformed tokens", async () => {
    const token = await pending();
    clock = new Date(clock.getTime() + 49 * 3600_000);
    expect(await newsletter().confirm(token)).toBe("expired");
    expect((await db().newsletterSubscriber.findFirstOrThrow()).confirmedAt).toBeNull();
    for (const bad of ["", "nope", "x".repeat(300)]) expect(await newsletter().confirm(bad)).toBe("invalid");
  });

  it("only lets one of two simultaneous clicks win", async () => {
    const token = await pending();
    const results = await Promise.all([newsletter().confirm(token), newsletter().confirm(token)]);
    expect(results.filter((r) => r === "confirmed")).toHaveLength(1);
    expect(await db().prospect.count()).toBe(1);
  });

  it("still confirms when the CRM step fails", async () => {
    const token = await pending();
    const broken = createNewsletterService({
      prisma: db(),
      queue: { enqueueEmail: async () => undefined },
      crm: { ingestLead: async () => { throw new Error("crm down"); } },
      sequences: sequences(),
      appUrl: "https://app.example.com",
      now: () => clock,
    });
    expect(await broken.confirm(token)).toBe("confirmed");
    expect((await db().newsletterSubscriber.findFirstOrThrow()).confirmedAt).not.toBeNull();
  });

  it("lets someone who unsubscribed come back with a fresh double opt-in, but not after a bounce", async () => {
    await newsletter().confirm(await pending());
    await newsletter().unsubscribe("awa@lagune.ci");
    expect(await db().suppression.findUniqueOrThrow({ where: { email: "awa@lagune.ci" } })).toMatchObject({ reason: "UNSUBSCRIBED" });

    emails = [];
    await newsletter().subscribe({ email: "awa@lagune.ci", ip: "1.1.1.1" });
    expect(emails).toHaveLength(1);
    expect(await newsletter().confirm(tokenOf(emails[0]!))).toBe("confirmed");
    expect(await db().suppression.count()).toBe(0);
    expect((await db().newsletterSubscriber.findFirstOrThrow()).unsubscribedAt).toBeNull();
  });
});

describe("unsubscribing", () => {
  it("excludes the address, closes the subscription and stops active sequences", async () => {
    await welcomeSequence();
    await newsletter().subscribe({ email: "awa@lagune.ci", ip: "1.1.1.1" });
    await newsletter().confirm(tokenOf(emails[0]!));
    expect(await db().sequenceEnrollment.count({ where: { status: "ACTIVE" } })).toBe(1);

    expect(await newsletter().unsubscribe("AWA@lagune.ci")).toEqual({ enrollmentsStopped: 1 });
    expect(await db().suppression.findUniqueOrThrow({ where: { email: "awa@lagune.ci" } })).toMatchObject({ reason: "UNSUBSCRIBED" });
    expect((await db().newsletterSubscriber.findFirstOrThrow()).unsubscribedAt).toEqual(clock);
    expect((await db().sequenceEnrollment.findFirstOrThrow()).status).toBe("UNSUBSCRIBED");
    expect((await newsletter().listSubscribers())[0]!.unsubscribedAt).toBe(clock.toISOString());
  });

  it("works for an address that never subscribed (a prospect receiving a sequence)", async () => {
    expect(await newsletter().unsubscribe("someone@else.ci")).toEqual({ enrollmentsStopped: 0 });
    expect(await db().suppression.count()).toBe(1);
  });

  it("is idempotent and keeps the strongest original reason", async () => {
    await db().suppression.create({ data: { email: "awa@lagune.ci", reason: "COMPLAINT" } });
    await newsletter().unsubscribe("awa@lagune.ci");
    await newsletter().unsubscribe("awa@lagune.ci");
    expect(await db().suppression.findMany()).toMatchObject([{ reason: "COMPLAINT" }]);
  });
});

describe("POST /api/newsletter/subscribe", () => {
  const ok = { email: "awa@lagune.ci", consent: true, turnstileToken: "valid" };
  const verifyHuman = vi.fn(async ({ token }: { token: string | undefined }) => token === "valid");
  const subscribed: string[] = [];
  const deps = (rateLimit?: never) => ({
    newsletter: { subscribe: async ({ email }: { email: string }) => void subscribed.push(email) },
    env: { TURNSTILE_SECRET_KEY: "s" },
    verifyHuman,
    ...(rateLimit ? { rateLimit } : {}),
  });

  const post = (body: unknown, ip = "198.51.100.7", headers: Record<string, string> = {}) =>
    handleSubscribe(
      new Request("https://app.example.com/api/newsletter/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
        body: JSON.stringify(body),
      }),
      deps(),
    );

  beforeEach(() => {
    subscribed.length = 0;
    verifyHuman.mockClear();
  });

  it("accepts a valid request and always answers the same", async () => {
    const response = await post(ok);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(subscribed).toEqual(["awa@lagune.ci"]);
  });

  it("requires consent, a valid email, JSON and no unknown fields", async () => {
    expect((await post({ ...ok, consent: false }, "10.0.0.1")).status).toBe(400);
    expect((await post({ ...ok, email: "nope" }, "10.0.0.2")).status).toBe(400);
    expect((await post({ ...ok, extra: 1 }, "10.0.0.3")).status).toBe(400);
    expect((await post(ok, "10.0.0.4", { "content-type": "text/plain" })).status).toBe(415);
    expect(subscribed).toHaveLength(0);
  });

  it("drops honeypot submissions silently, and refuses a missing Turnstile proof", async () => {
    const trap = await post({ ...ok, website: "http://spam.example" }, "10.0.1.1");
    expect(trap.status).toBe(200);
    expect(verifyHuman).not.toHaveBeenCalled();
    expect((await post({ ...ok, turnstileToken: undefined }, "10.0.1.2")).status).toBe(400);
    expect(subscribed).toHaveLength(0);
  });

  it("limits each IP to 5 requests an hour", async () => {
    for (let i = 0; i < 5; i++) expect((await post({ ...ok, email: `p${i}@x.ci` }, "10.0.2.1")).status).toBe(200);
    const blocked = await post(ok, "10.0.2.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
    expect((await post(ok, "10.0.2.2")).status).toBe(200);
  });

  it("looks successful but sends nothing when one address is hit too often (mail-bombing)", async () => {
    for (let i = 0; i < 3; i++) expect((await post(ok, `10.0.3.${i}`)).status).toBe(200);
    expect(subscribed).toHaveLength(3);
    const fourth = await post(ok, "10.0.3.9");
    expect(fourth.status).toBe(200);
    expect(await fourth.json()).toEqual({ ok: true });
    expect(subscribed).toHaveLength(3);
  });

  it("does not leak server errors", async () => {
    const broken = await handleSubscribe(
      new Request("https://app.example.com/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.4.1" }, body: JSON.stringify(ok) }),
      { ...deps(), newsletter: { subscribe: async () => { throw new Error("db password is hunter2"); } } },
    );
    expect(broken.status).toBe(500);
    expect(JSON.stringify(await broken.json())).not.toContain("hunter2");
  });
});

describe("GET /api/newsletter/confirm", () => {
  it("redirects to the confirmation page with the outcome", async () => {
    await newsletter().subscribe({ email: "awa@lagune.ci", ip: "1.1.1.1" });
    const token = tokenOf(emails[0]!);
    // The route uses the real service: it reads the same database.
    const ok = await confirmRoute(new Request(`https://app.example.com/api/newsletter/confirm?token=${token}`));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("http://localhost:3000/newsletter/confirmation?status=confirmed");
    const again = await confirmRoute(new Request(`https://app.example.com/api/newsletter/confirm?token=${token}`));
    expect(again.headers.get("location")).toContain("status=invalid");
    const missing = await confirmRoute(new Request("https://app.example.com/api/newsletter/confirm"));
    expect(missing.headers.get("location")).toContain("status=invalid");
  });
});

describe("unsubscribe link", () => {
  const unsubscribed: string[] = [];
  const deps = { newsletter: { unsubscribe: async (email: string) => { unsubscribed.push(email); return { enrollmentsStopped: 0 }; } }, secret: SECRET };
  const link = (token: string) => `https://app.example.com/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
  const good = signToken("unsub", { email: "awa@lagune.ci" }, SECRET);
  beforeEach(() => void (unsubscribed.length = 0));

  it("GET only shows a confirmation button: scanners that open links must not unsubscribe anyone", async () => {
    const response = await handleUnsubscribe(new Request(link(good)), deps);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<form method=\"post\"");
    expect(html).toContain("Me désinscrire");
    expect(unsubscribed).toHaveLength(0);
  });

  it("POST unsubscribes in one click, also for mail clients (RFC 8058)", async () => {
    const form = await handleUnsubscribe(new Request(link(good), { method: "POST" }), deps);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain("Vous êtes désinscrit");

    const oneClick = await handleUnsubscribe(
      new Request(link(good), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }),
      deps,
    );
    expect(oneClick.status).toBe(200);
    expect(unsubscribed).toEqual(["awa@lagune.ci", "awa@lagune.ci"]);
  });

  it("works without any session, and the page is not indexable or cacheable", async () => {
    const response = await handleUnsubscribe(new Request(link(good)), deps);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('name="robots" content="noindex"');
  });

  it("refuses forged, altered, foreign-purpose and missing tokens", async () => {
    const forged = signToken("unsub", { email: "victim@acme.ci" }, "other-secret".repeat(4));
    const wrongPurpose = signToken("open", { email: "awa@lagune.ci" }, SECRET);
    for (const token of [forged, wrongPurpose, good.slice(0, -3) + "AAA", "", "garbage"]) {
      for (const method of ["GET", "POST"]) {
        expect((await handleUnsubscribe(new Request(link(token), { method }), deps)).status).toBe(400);
      }
    }
    expect((await handleUnsubscribe(new Request("https://app.example.com/api/newsletter/unsubscribe"), deps)).status).toBe(400);
    expect(unsubscribed).toHaveLength(0);
  });

  it("escapes what it prints", async () => {
    const response = await handleUnsubscribe(new Request(link(good) + '"><script>alert(1)</script>'), deps);
    expect(await response.text()).not.toContain("<script>alert(1)</script>");
  });
});
