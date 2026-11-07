import { createJobQueue, jobIdFromKey, type JobQueue, QUEUE_DEFINITIONS } from "@manga/db/queue";
import { QUEUES, type EmailJob } from "@manga/emails";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleEmailSend } from "../src/jobs/email-send";
import { handleFanout } from "../src/jobs/fanout";
import { MemoryProvider, TEST_DATABASE_URL, createUser, db, makeDeps, resetDatabase, shutdown, waitFor } from "./helpers";

const url = "https://app.example.com/lien?token=abc";
const reset = (to = "awa@lagune.ci"): EmailJob => ({ template: "password-reset", to, data: { name: "Awa", url } });

// Same queues as production, but with a 1 second retry delay so the test is quick.
const fastDefinitions = Object.fromEntries(
  Object.entries(QUEUE_DEFINITIONS).map(([name, definition]) => [name, { ...definition, retryDelay: 1, retryBackoff: false }]),
);

let queue: JobQueue;
let provider: MemoryProvider;

beforeAll(async () => {
  queue = await createJobQueue(TEST_DATABASE_URL, { worker: true, schema: "pgboss_test", definitions: fastDefinitions });
});

beforeEach(async () => {
  await resetDatabase();
  // Start every test from empty queues and a fresh worker.
  for (const name of Object.values(QUEUES)) {
    await queue.boss.offWork(name);
    await queue.boss.deleteAllJobs(name);
  }
  const made = makeDeps({ queue });
  provider = made.provider;
  await queue.boss.work(QUEUES.emailSend, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
    for (const job of jobs) await handleEmailSend(job.data, made.deps);
  });
  await queue.boss.work(QUEUES.notificationsFanout, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
    for (const job of jobs) await handleFanout(job, made.deps);
  });
});

afterAll(async () => {
  await queue?.stop();
  await shutdown();
});

describe("jobIdFromKey", () => {
  it("is a stable UUID per key", () => {
    const id = jobIdFromKey("email.send:invite:u1");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(jobIdFromKey("email.send:invite:u1")).toBe(id);
    expect(jobIdFromKey("email.send:invite:u2")).not.toBe(id);
  });
});

describe("email.send through pg-boss", () => {
  it("delivers a queued email", async () => {
    await queue.enqueueEmail(reset());
    await waitFor(() => provider.sent.length === 1);
    expect(provider.sent[0]).toMatchObject({ to: "awa@lagune.ci", subject: "Réinitialisation de votre mot de passe" });
  });

  it("retries after a transient failure, then delivers exactly once", async () => {
    provider.failures = [new Error("Brevo answered 503")];
    await queue.enqueueEmail(reset());
    await waitFor(() => provider.sent.length === 1, 30_000);
    expect(provider.failures).toHaveLength(0); // the failed attempt really happened
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(provider.sent).toHaveLength(1);
  });

  it("gives up after the attempts are exhausted, without losing the worker", async () => {
    provider.failures = Array.from({ length: 4 }, () => new Error("Brevo answered 503"));
    await queue.enqueueEmail(reset("lost@lagune.ci"));
    await waitFor(() => provider.failures.length === 0, 30_000); // 1 attempt + 3 retries
    expect(provider.sent).toHaveLength(0);

    await queue.enqueueEmail(reset("next@lagune.ci"));
    await waitFor(() => provider.sent.length === 1);
    expect(provider.sent[0]!.to).toBe("next@lagune.ci");
  });

  it("deduplicates jobs that share a key", async () => {
    await queue.enqueueEmail(reset(), { dedupeKey: "reset:u1:2026-11-06" });
    await queue.enqueueEmail(reset(), { dedupeKey: "reset:u1:2026-11-06" });
    await queue.enqueueEmail(reset("other@lagune.ci"), { dedupeKey: "reset:u2:2026-11-06" });
    await waitFor(() => provider.sent.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(provider.sent.map((e) => e.to).sort()).toEqual(["awa@lagune.ci", "other@lagune.ci"]);
  });
});

describe("notifications.fanout through pg-boss", () => {
  it("creates the in-app notification, then sends the email, end to end", async () => {
    const admin = await createUser("ADMIN");
    await queue.enqueueFanout({
      type: "NEW_LEAD",
      audience: "ADMINS",
      payload: { prospectId: "p1", returning: false },
      email: { template: "new-lead", to: "admin@example.com", data: { contactName: "Awa", companyName: "Lagune", sourceLabel: "le chatbot", returning: false, url } },
    });
    await waitFor(() => provider.sent.length === 1);
    expect(provider.sent[0]).toMatchObject({ to: "admin@example.com" });
    const notifications = await db().notification.findMany();
    expect(notifications).toMatchObject([{ userId: admin.id, type: "NEW_LEAD" }]);
  });

  it("keeps a fan-out with the same dedupe key to a single run", async () => {
    await createUser("ADMIN");
    const job = { type: "FOLLOW_UP_DUE", audience: "ADMINS" as const, payload: { date: "2026-11-06" } };
    await queue.enqueueFanout(job, { dedupeKey: "digest:2026-11-06" });
    await queue.enqueueFanout(job, { dedupeKey: "digest:2026-11-06" });
    await waitFor(async () => (await db().notification.count()) >= 1);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(await db().notification.count()).toBe(1);
  });
});
