import { PermanentEmailError, type EmailJob } from "@manga/emails";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runDailyDigest } from "../src/jobs/daily-digest";
import { handleEmailSend } from "../src/jobs/email-send";
import { handleFanout } from "../src/jobs/fanout";
import { createUser, db, makeDeps, resetDatabase, shutdown } from "./helpers";

beforeEach(resetDatabase);
afterAll(shutdown);

const url = "https://app.example.com/lien?token=abc";
const reset: EmailJob = { template: "password-reset", to: "awa@lagune.ci", data: { name: "Awa", url } };

describe("email.send", () => {
  it("renders the template and sends it from the transactional address", async () => {
    const { deps, provider } = makeDeps();
    await handleEmailSend(reset, deps);
    expect(provider.sent).toHaveLength(1);
    const [email] = provider.sent;
    expect(email).toMatchObject({ from: "Cabinet <no-reply@example.com>", to: "awa@lagune.ci" });
    expect(email!.subject).toBe("Réinitialisation de votre mot de passe");
    expect(email!.html).toContain(url);
    expect(email!.text).toContain(url);
  });

  it("uses the cabinet details from the settings in the footer", async () => {
    await db().setting.create({ data: { key: "cabinet", value: { cabinetName: "Cabinet Test", phone: "+225 01 02 03 04 05" } } });
    const { deps, provider } = makeDeps();
    await handleEmailSend(reset, deps);
    expect(provider.sent[0]!.text).toContain("Cabinet Test");
    expect(provider.sent[0]!.text).toContain("+225 01 02 03 04 05");
  });

  it("drops a malformed payload without throwing or sending", async () => {
    const { deps, provider } = makeDeps();
    await expect(handleEmailSend({ template: "password-reset", to: "nope", data: {} }, deps)).resolves.toBeUndefined();
    await expect(handleEmailSend(null, deps)).resolves.toBeUndefined();
    expect(provider.sent).toHaveLength(0);
  });

  it("rethrows transient provider failures so the job is retried", async () => {
    const { deps, provider } = makeDeps();
    provider.failures = [new Error("Brevo answered 503")];
    await expect(handleEmailSend(reset, deps)).rejects.toThrow("503");
    expect(provider.sent).toHaveLength(0);
  });

  it("swallows permanent rejections: retrying cannot help", async () => {
    const { deps, provider } = makeDeps();
    provider.failures = [new PermanentEmailError("Brevo answered 401")];
    await expect(handleEmailSend(reset, deps)).resolves.toBeUndefined();
  });
});

describe("notifications.fanout", () => {
  const lead = (extra: object = {}) => ({
    id: "job-1",
    data: {
      type: "NEW_LEAD",
      audience: "ADMINS",
      payload: { prospectId: "p1" },
      email: { template: "new-lead", to: "admin@example.com", data: { contactName: "Awa", companyName: "Lagune", sourceLabel: "le chatbot", returning: false, url } },
      ...extra,
    },
  });

  it("notifies active admins only, and queues the email once", async () => {
    const admin = await createUser("ADMIN");
    await createUser("ADMIN", { disabledAt: new Date() });
    await createUser("CLIENT");
    const { deps, queue } = makeDeps();

    await handleFanout(lead(), deps);

    const notifications = await db().notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: admin.id, type: "NEW_LEAD", payload: { prospectId: "p1", _job: "job-1" } });
    expect(queue.emails).toMatchObject([{ job: { template: "new-lead" }, dedupeKey: "fanout:job-1" }]);
  });

  it("is idempotent: a retry of the same job notifies nobody twice", async () => {
    await createUser("ADMIN");
    const { deps, queue } = makeDeps();
    await handleFanout(lead(), deps);
    await handleFanout(lead(), deps);
    expect(await db().notification.count()).toBe(1);
    // The email is requested again, but with the same key: the queue keeps a single job.
    expect(new Set(queue.emails.map((e) => e.dedupeKey)).size).toBe(1);
  });

  it("notifies a newly created admin on retry, not the ones already notified", async () => {
    const first = await createUser("ADMIN");
    const { deps } = makeDeps();
    await handleFanout(lead(), deps);
    const second = await createUser("ADMIN");
    await handleFanout(lead(), deps);
    const owners = (await db().notification.findMany()).map((n) => n.userId).sort();
    expect(owners).toEqual([first.id, second.id].sort());
  });

  it("targets a single user, skipping disabled accounts", async () => {
    const target = await createUser("CLIENT");
    const disabled = await createUser("CLIENT", { disabledAt: new Date() });
    const { deps } = makeDeps();
    await handleFanout({ id: "job-2", data: { type: "NEW_MESSAGE", audience: { userId: target.id }, payload: {} } }, deps);
    await handleFanout({ id: "job-3", data: { type: "NEW_MESSAGE", audience: { userId: disabled.id }, payload: {} } }, deps);
    expect((await db().notification.findMany()).map((n) => n.userId)).toEqual([target.id]);
  });

  it("works without an email and drops malformed payloads", async () => {
    await createUser("ADMIN");
    const { deps, queue } = makeDeps();
    await handleFanout({ id: "job-4", data: { type: "X", audience: "ADMINS", payload: {} } }, deps);
    expect(queue.emails).toHaveLength(0);
    expect(await db().notification.count()).toBe(1);
    await expect(handleFanout({ id: "job-5", data: { type: "", audience: "ADMINS" } }, deps)).resolves.toBeUndefined();
    expect(await db().notification.count()).toBe(1);
  });
});

describe("followups.daily-digest", () => {
  const now = new Date("2026-11-06T07:00:00Z");

  async function followUp(company: string, dueAt: string, extra: { doneAt?: Date; cancelledAt?: Date; deleted?: boolean } = {}) {
    const prospect = await db().prospect.create({
      data: { companyName: company, companyNameNorm: company.toLowerCase(), sector: "x", source: "MANUEL", deletedAt: extra.deleted ? new Date() : null },
    });
    return db().followUp.create({
      data: { prospectId: prospect.id, rule: "J+7", dueAt: new Date(dueAt), doneAt: extra.doneAt, cancelledAt: extra.cancelledAt },
    });
  }

  it("queues one digest with the overdue and due-today follow-ups", async () => {
    await followUp("En retard SARL", "2026-11-03T09:00:00Z");
    await followUp("Aujourdhui SA", "2026-11-06T15:00:00Z");
    await followUp("Demain SA", "2026-11-07T09:00:00Z");
    const { deps, queue } = makeDeps({ now: () => now });

    expect(await runDailyDigest(deps)).toEqual({ today: 1, overdue: 1 });

    expect(queue.fanouts).toHaveLength(1);
    const [{ job, dedupeKey }] = queue.fanouts;
    expect(dedupeKey).toBe("digest:2026-11-06");
    expect(job).toMatchObject({ type: "FOLLOW_UP_DUE", audience: "ADMINS", payload: { date: "2026-11-06", overdue: 1, today: 1 } });
    expect(job.email).toMatchObject({
      template: "daily-digest",
      to: "admin@example.com",
      data: {
        date: "2026-11-06",
        adminUrl: "https://app.example.com/admin/relances",
        overdue: [{ company: "En retard SARL", rule: "J+7" }],
        today: [{ company: "Aujourdhui SA" }],
      },
    });
  });

  it("ignores done, cancelled and deleted-prospect follow-ups", async () => {
    await followUp("Fait", "2026-11-05T09:00:00Z", { doneAt: new Date() });
    await followUp("Annulée", "2026-11-05T09:00:00Z", { cancelledAt: new Date() });
    await followUp("Supprimé", "2026-11-05T09:00:00Z", { deleted: true });
    const { deps, queue } = makeDeps({ now: () => now });
    expect(await runDailyDigest(deps)).toEqual({ today: 0, overdue: 0 });
    expect(queue.fanouts).toHaveLength(0);
  });

  it("sends nothing on a quiet day", async () => {
    await followUp("Plus tard", "2026-12-01T09:00:00Z");
    const { deps, queue } = makeDeps({ now: () => now });
    await runDailyDigest(deps);
    expect(queue.fanouts).toHaveLength(0);
  });

  it("uses the same dedupe key for the same business day, a new one the next day", async () => {
    await followUp("En retard", "2026-11-03T09:00:00Z");
    const first = makeDeps({ now: () => now });
    await runDailyDigest(first.deps);
    await runDailyDigest(first.deps);
    expect(new Set(first.queue.fanouts.map((f) => f.dedupeKey))).toEqual(new Set(["digest:2026-11-06"]));

    const next = makeDeps({ now: () => new Date("2026-11-07T07:00:00Z") });
    await runDailyDigest(next.deps);
    expect(next.queue.fanouts[0]!.dedupeKey).toBe("digest:2026-11-07");
  });

  it("caps the lists in the email but reports the real counts", async () => {
    for (let i = 0; i < 55; i++) await followUp(`Société ${i}`, "2026-11-04T09:00:00Z");
    const { deps, queue } = makeDeps({ now: () => now });
    await runDailyDigest(deps);
    const { job } = queue.fanouts[0]!;
    expect(job.payload.overdue).toBe(55);
    expect(job.email!.template === "daily-digest" && job.email!.data.overdue).toHaveLength(50);
  });
});
