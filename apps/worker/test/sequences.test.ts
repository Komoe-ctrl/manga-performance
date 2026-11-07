import { verifyToken } from "@manga/core";
import { textToTiptap } from "@manga/core/rich-text";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleEmailSend } from "../src/jobs/email-send";
import { runPurgeUnconfirmed, runSequenceDispatch } from "../src/jobs/sequences";
import { db, makeDeps, resetDatabase, shutdown } from "./helpers";

const SECRET = "t".repeat(40);
const friday = new Date("2026-11-06T10:00:00Z");
const DAY = 86_400_000;

let seq = 0;

async function sequence(opts: { active?: boolean; steps?: { delayDays: number; subject: string; body: string }[] } = {}) {
  const steps = opts.steps ?? [
    { delayDays: 0, subject: "Bonjour {{prenom|cher client}}", body: "Bonjour {{prenom}},\n\n{{entreprise}} ({{secteur}}) : parlons de {{besoin}}. Voir https://example.com/offre" },
    { delayDays: 3, subject: "Suite pour {{entreprise}}", body: "Un petit rappel." },
  ];
  const created = await db().emailSequence.create({ data: { name: `Séquence ${++seq}`, trigger: "MANUAL", active: opts.active ?? true } });
  for (const [index, step] of steps.entries()) {
    await db().sequenceStep.create({ data: { sequenceId: created.id, order: index + 1, delayDays: step.delayDays, subject: step.subject, bodyJson: textToTiptap(step.body) as object } });
  }
  return created;
}

async function enroll(sequenceId: string, extra: { prospect?: Record<string, unknown>; enrollment?: Record<string, unknown> } = {}) {
  seq += 1;
  const prospect = await db().prospect.create({
    data: {
      companyName: `Société ${seq}`,
      companyNameNorm: `societe ${seq}`,
      contactName: "Awa Koné",
      email: `contact${seq}@example.com`,
      sector: "Hôtellerie",
      need: "AUDIT",
      source: "MANUEL",
      ...extra.prospect,
    },
  });
  const enrollment = await db().sequenceEnrollment.create({
    data: { sequenceId, prospectId: prospect.id, status: "ACTIVE", currentStep: 0, nextSendAt: new Date(friday.getTime() - 1000), ...extra.enrollment },
  });
  return { prospect, enrollment };
}

const at = (iso: string | Date) => makeDeps({ now: () => (typeof iso === "string" ? new Date(iso) : iso) });
const status = async (id: string) => (await db().sequenceEnrollment.findUniqueOrThrow({ where: { id } })).status;

beforeEach(async () => {
  await resetDatabase();
  await db().$executeRawUnsafe(`TRUNCATE TABLE "EmailEvent", "Suppression", "NewsletterSubscriber", "SequenceStep", "EmailSequence" CASCADE`);
});
afterAll(shutdown);

describe("sending a step", () => {
  it("personalises the email, tracks links and opens, and adds a signed unsubscribe link", async () => {
    const s = await sequence();
    // A real link: TipTap marks it, the dispatcher rewrites it for click tracking.
    await db().sequenceStep.updateMany({
      where: { sequenceId: s.id, order: 1 },
      data: {
        bodyJson: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Bonjour {{prenom}}," }] },
            { type: "paragraph", content: [{ type: "text", text: "{{entreprise}} ({{secteur}}) : parlons de {{besoin}}. " }, { type: "text", text: "Notre offre", marks: [{ type: "link", attrs: { href: "https://example.com/offre" } }] }] },
          ],
        },
      },
    });
    const { prospect, enrollment } = await enroll(s.id);
    const { deps, queue } = at(friday);

    expect(await runSequenceDispatch(deps)).toMatchObject({ queued: 1, stopped: 0 });

    expect(queue.emails).toHaveLength(1);
    const { job, dedupeKey } = queue.emails[0]!;
    expect(dedupeKey).toBe(`seq:${enrollment.id}:1`);
    expect(job).toMatchObject({ template: "marketing", to: prospect.email, enrollmentId: enrollment.id });
    if (job.template !== "marketing") throw new Error("wrong template");

    expect(job.data.subject).toBe("Bonjour Awa");
    expect(job.data.bodyHtml).toContain("Bonjour Awa,");
    expect(job.data.bodyHtml).toContain(`${prospect.companyName} (Hôtellerie) : parlons de votre audit.`);

    const click = /href="https:\/\/app\.example\.com\/api\/t\/c\/([^"]+)"/.exec(job.data.bodyHtml);
    expect(click).not.toBeNull();
    expect(verifyToken("click", click![1]!, SECRET)).toEqual({ e: enrollment.id, s: 1, u: "https://example.com/offre" });
    expect(verifyToken("open", job.data.pixelUrl!.split("/").pop()!, SECRET)).toEqual({ e: enrollment.id, s: 1 });
    const unsub = new URL(job.data.unsubscribeUrl);
    expect(unsub.pathname).toBe("/api/newsletter/unsubscribe");
    expect(verifyToken("unsub", unsub.searchParams.get("token")!, SECRET)).toEqual({ email: prospect.email });
  });

  it("advances to the next step by its own delay, logs it, then completes after the last step", async () => {
    const s = await sequence();
    const { enrollment } = await enroll(s.id);
    await runSequenceDispatch(at(friday).deps);

    expect(await db().sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).toMatchObject({ status: "ACTIVE", currentStep: 1, nextSendAt: new Date(friday.getTime() + 3 * DAY) });
    expect(await db().emailEvent.findMany()).toMatchObject([{ type: "QUEUED", enrollmentId: enrollment.id, messageId: `seq:${enrollment.id}:1` }]);

    // Not due yet: nothing happens.
    const early = at(new Date(friday.getTime() + DAY));
    expect(await runSequenceDispatch(early.deps)).toMatchObject({ queued: 0 });

    // Wednesday 11 November: second and last step.
    const later = at("2026-11-11T10:00:00Z");
    expect(await runSequenceDispatch(later.deps)).toMatchObject({ queued: 1 });
    expect(later.queue.emails[0]!.job).toMatchObject({ data: { subject: expect.stringContaining("Société") } });
    expect(await db().sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).toMatchObject({ status: "COMPLETED", nextSendAt: null, currentStep: 2 });
  });

  it("uses fallbacks for missing contact details and hides an email used as company name", async () => {
    const s = await sequence();
    await enroll(s.id, { prospect: { contactName: null, companyName: "abonne@example.com", sector: "Non précisé", need: null } });
    const { deps, queue } = at(friday);
    await runSequenceDispatch(deps);
    const job = queue.emails[0]!.job;
    if (job.template !== "marketing") throw new Error("wrong template");
    expect(job.data.subject).toBe("Bonjour cher client");
    expect(job.data.bodyHtml).toContain("votre entreprise (votre secteur) : parlons de vos besoins.");
    expect(job.data.bodyHtml).not.toContain("abonne@example.com");
  });

  it("escapes what comes from the database, so a contact name cannot inject HTML", async () => {
    const s = await sequence();
    await enroll(s.id, { prospect: { contactName: "<img src=x onerror=alert(1)>", companyName: "A <b>&</b> Co" } });
    const { deps, queue } = at(friday);
    await runSequenceDispatch(deps);
    const job = queue.emails[0]!.job;
    if (job.template !== "marketing") throw new Error("wrong template");
    expect(job.data.bodyHtml).not.toContain("<img");
    expect(job.data.bodyHtml).not.toContain("<b>");
    expect(job.data.bodyHtml).toContain("&lt;img");
  });
});

describe("guard-rails", () => {
  it.each([
    ["Saturday", "2026-11-07T10:00:00Z"],
    ["Sunday", "2026-11-08T10:00:00Z"],
    ["before 08:00", "2026-11-06T07:59:00Z"],
    ["from 18:00", "2026-11-06T18:00:00Z"],
  ])("sends nothing %s", async (_label, iso) => {
    const s = await sequence();
    const { enrollment } = await enroll(s.id);
    const { deps, queue } = at(iso);
    expect(await runSequenceDispatch(deps)).toMatchObject({ queued: 0, idle: "OUTSIDE_WINDOW" });
    expect(queue.emails).toHaveLength(0);
    expect(await status(enrollment.id)).toBe("ACTIVE");
  });

  it("catches up once the window opens again", async () => {
    const s = await sequence();
    await enroll(s.id);
    expect((await runSequenceDispatch(at("2026-11-07T10:00:00Z").deps)).queued).toBe(0);
    const monday = at("2026-11-09T08:00:00Z");
    expect((await runSequenceDispatch(monday.deps)).queued).toBe(1);
  });

  it("honours the daily cap from the settings, across runs, and resumes the next day", async () => {
    // One step only, so Monday's allowance goes to the two contacts left over on Friday.
    const s = await sequence({ steps: [{ delayDays: 0, subject: "x", body: "y" }] });
    for (let i = 0; i < 5; i++) await enroll(s.id, { enrollment: { nextSendAt: new Date("2026-11-06T00:00:00Z") } });
    await db().setting.create({ data: { key: "marketing", value: { dailyCap: 3 } } });

    const morning = at("2026-11-06T09:00:00Z");
    expect(await runSequenceDispatch(morning.deps)).toMatchObject({ queued: 3 });
    const afternoon = at("2026-11-06T15:00:00Z");
    expect(await runSequenceDispatch(afternoon.deps)).toMatchObject({ queued: 0, idle: "CAP_REACHED" });

    // Monday morning: a new day, a new allowance.
    const monday = at("2026-11-09T09:00:00Z");
    expect(await runSequenceDispatch(monday.deps)).toMatchObject({ queued: 2 });
  });

  it("starts at 50 emails a day by default", async () => {
    const s = await sequence({ steps: [{ delayDays: 0, subject: "x", body: "y" }] });
    for (let i = 0; i < 52; i++) await enroll(s.id);
    const { deps, queue } = at(friday);
    expect(await runSequenceDispatch(deps)).toMatchObject({ queued: 50 });
    expect(queue.emails).toHaveLength(50);
  });

  it.each([
    ["UNSUBSCRIBED", "UNSUBSCRIBED"],
    ["HARD_BOUNCE", "BOUNCED"],
    ["COMPLAINT", "BOUNCED"],
    ["MANUAL", "STOPPED"],
  ])("never sends to a suppressed address (%s) and ends the enrolment as %s", async (reason, expected) => {
    const s = await sequence();
    const { prospect, enrollment } = await enroll(s.id);
    await db().suppression.create({ data: { email: prospect.email!.toUpperCase(), reason } });
    const { deps, queue } = at(friday);
    expect(await runSequenceDispatch(deps)).toMatchObject({ queued: 0, stopped: 1 });
    expect(queue.emails).toHaveLength(0);
    expect(await status(enrollment.id)).toBe(expected);
  });

  it.each([
    ["a client", { status: "CLIENT" }],
    ["a lost prospect", { status: "PERDU" }],
    ["a deleted prospect", { deletedAt: new Date() }],
    ["a prospect without email", { email: null }],
  ])("stops the sequence for %s", async (_label, prospect) => {
    const s = await sequence();
    const { enrollment } = await enroll(s.id, { prospect });
    const { deps, queue } = at(friday);
    expect(await runSequenceDispatch(deps)).toMatchObject({ queued: 0, stopped: 1 });
    expect(queue.emails).toHaveLength(0);
    expect(await status(enrollment.id)).toBe("STOPPED");
  });

  it("ignores inactive sequences, future steps and non-active enrolments", async () => {
    const off = await sequence({ active: false });
    const on = await sequence();
    await enroll(off.id);
    await enroll(on.id, { enrollment: { nextSendAt: new Date(friday.getTime() + 1000) } });
    await enroll(on.id, { enrollment: { status: "STOPPED" } });
    await enroll(on.id, { enrollment: { nextSendAt: null } });
    const { deps, queue } = at(friday);
    expect(await runSequenceDispatch(deps)).toEqual({ queued: 0, stopped: 0, skipped: 0 });
    expect(queue.emails).toHaveLength(0);
  });

  it("stops an enrolment whose step body is corrupt, without blocking the others", async () => {
    const broken = await sequence();
    await db().sequenceStep.updateMany({ where: { sequenceId: broken.id }, data: { bodyJson: { type: "paragraph" } } });
    const fine = await sequence();
    const bad = await enroll(broken.id);
    await enroll(fine.id);
    const { deps, queue } = at(friday);
    expect(await runSequenceDispatch(deps)).toMatchObject({ queued: 1, stopped: 1 });
    expect(await status(bad.enrollment.id)).toBe("STOPPED");
    expect(queue.emails).toHaveLength(1);
  });
});

describe("robustness", () => {
  it("gives the step back when the queue is down, and carries on", async () => {
    const s = await sequence();
    const first = await enroll(s.id);
    await enroll(s.id);
    const made = at(friday);
    let calls = 0;
    made.deps.queue = {
      enqueueEmail: async (job, options) => {
        calls++;
        if (calls === 1) throw new Error("queue down");
        await made.queue.enqueueEmail(job, options);
      },
      enqueueFanout: async () => undefined,
    };
    expect(await runSequenceDispatch(made.deps)).toMatchObject({ queued: 1, skipped: 1 });
    expect(await db().sequenceEnrollment.findUniqueOrThrow({ where: { id: first.enrollment.id } })).toMatchObject({ status: "ACTIVE", currentStep: 0 });
    expect(await db().emailEvent.count({ where: { enrollmentId: first.enrollment.id } })).toBe(0);
    // The next run picks it up.
    const retry = at(friday);
    expect(await runSequenceDispatch(retry.deps)).toMatchObject({ queued: 1 });
  });

  it("never sends the same step twice when two runs overlap", async () => {
    const s = await sequence();
    await enroll(s.id);
    const a = at(friday);
    const b = at(friday);
    const [first, second] = await Promise.all([runSequenceDispatch(a.deps), runSequenceDispatch(b.deps)]);
    expect(first.queued + second.queued).toBe(1);
    expect(a.queue.emails.length + b.queue.emails.length).toBe(1);
  });
});

describe("email.send for marketing", () => {
  const job = (to: string, extra: object = {}) => ({
    template: "marketing",
    to,
    enrollmentId: "enr1",
    data: { subject: "Bonjour", bodyHtml: "<p>Contenu</p>", unsubscribeUrl: "https://app.example.com/api/newsletter/unsubscribe?token=abc", pixelUrl: "https://app.example.com/api/t/o/xyz" },
    ...extra,
  });

  it("leaves from the marketing address with one-click unsubscribe headers, and records the provider id", async () => {
    const s = await sequence();
    const { enrollment } = await enroll(s.id);
    const { deps, provider } = makeDeps();
    await handleEmailSend(job("awa@example.com", { enrollmentId: enrollment.id }), deps);

    expect(provider.sent).toHaveLength(1);
    const email = provider.sent[0]!;
    expect(email.from).toBe("Cabinet News <news@example.com>");
    expect(email.headers).toEqual({
      "List-Unsubscribe": "<https://app.example.com/api/newsletter/unsubscribe?token=abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(email.html).toContain("<p>Contenu</p>");
    expect(email.html).toContain("Se désinscrire");
    expect(email.html).toContain("https://app.example.com/api/t/o/xyz");
    expect(email.text).toContain("Contenu");
    expect(await db().emailEvent.findFirstOrThrow({ where: { type: "SENT" } })).toMatchObject({ messageId: "memory-1", enrollmentId: enrollment.id, email: "awa@example.com" });
  });

  it("checks the suppression list again right before sending", async () => {
    await db().suppression.create({ data: { email: "awa@example.com", reason: "UNSUBSCRIBED" } });
    const { deps, provider } = makeDeps();
    await handleEmailSend(job("Awa@Example.com"), deps);
    expect(provider.sent).toHaveLength(0);
    expect(await db().emailEvent.count()).toBe(0);
  });

  it("does not apply the marketing list to transactional emails", async () => {
    await db().suppression.create({ data: { email: "awa@example.com", reason: "COMPLAINT" } });
    const { deps, provider } = makeDeps();
    await handleEmailSend({ template: "password-reset", to: "awa@example.com", data: { name: "Awa", url: "https://app.example.com/reinitialisation?token=t" } }, deps);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.from).toBe("Cabinet <no-reply@example.com>");
    expect(provider.sent[0]!.headers).toBeUndefined();
  });

  it("records nothing when the provider fails, so the retry can still send", async () => {
    const { deps, provider } = makeDeps();
    provider.failures = [new Error("Brevo answered 503")];
    await expect(handleEmailSend(job("awa@example.com"), deps)).rejects.toThrow("503");
    expect(await db().emailEvent.count()).toBe(0);
  });
});

describe("newsletter.purge-unconfirmed", () => {
  it("deletes signups still unconfirmed after 7 days, and nothing else", async () => {
    const old = new Date(friday.getTime() - 8 * DAY);
    const recent = new Date(friday.getTime() - 6 * DAY);
    await db().newsletterSubscriber.create({ data: { email: "old-unconfirmed@example.com", createdAt: old } });
    await db().newsletterSubscriber.create({ data: { email: "recent-unconfirmed@example.com", createdAt: recent } });
    await db().newsletterSubscriber.create({ data: { email: "old-confirmed@example.com", createdAt: old, confirmedAt: old } });
    const { deps } = at(friday);
    expect(await runPurgeUnconfirmed(deps)).toEqual({ purged: 1 });
    expect((await db().newsletterSubscriber.findMany({ orderBy: { email: "asc" } })).map((s) => s.email)).toEqual(["old-confirmed@example.com", "recent-unconfirmed@example.com"]);
    expect(await runPurgeUnconfirmed(deps)).toEqual({ purged: 0 });
  });
});
