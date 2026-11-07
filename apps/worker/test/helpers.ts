import { createLogger } from "@manga/core";
import { createPrismaClient, type PrismaClient } from "@manga/db";
import type { EmailJob, EmailProvider, OutboundEmail } from "@manga/emails";
import type { FanoutJob } from "@manga/emails/jobs";
import type { WorkerDeps } from "../src/deps";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://manga:manga_dev_password@localhost:5434/manga_test";

let prisma: PrismaClient | undefined;
export const db = (): PrismaClient => (prisma ??= createPrismaClient(TEST_DATABASE_URL));

export async function resetDatabase(): Promise<void> {
  await db().$executeRawUnsafe(
    `TRUNCATE TABLE "User", "Session", "Account", "Verification", "TwoFactor", "Client", "Prospect",
      "Notification", "AuditLog", "Interaction", "FollowUp", "Setting", "InvoiceCounter",
      "EmailEvent", "Suppression", "NewsletterSubscriber", "SequenceEnrollment", "SequenceStep", "EmailSequence" CASCADE`,
  );
}

export async function shutdown(): Promise<void> {
  await prisma?.$disconnect();
  prisma = undefined;
}

/** Keeps every email instead of sending it. `failures` makes the next sends throw. */
export class MemoryProvider implements EmailProvider {
  readonly name = "memory";
  sent: OutboundEmail[] = [];
  failures: Error[] = [];
  async send(email: OutboundEmail) {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(email);
    return { messageId: `memory-${this.sent.length}` };
  }
}

/** Records enqueued jobs, deduplicating like the real queue does. */
export class FakeQueue {
  emails: { job: EmailJob; dedupeKey?: string }[] = [];
  fanouts: { job: FanoutJob; dedupeKey?: string }[] = [];
  async enqueueEmail(job: EmailJob, options?: { dedupeKey?: string }) {
    this.emails.push({ job, dedupeKey: options?.dedupeKey });
  }
  async enqueueFanout(job: FanoutJob, options?: { dedupeKey?: string }) {
    this.fanouts.push({ job, dedupeKey: options?.dedupeKey });
  }
}

export function makeDeps(overrides: Partial<WorkerDeps> = {}) {
  const provider = new MemoryProvider();
  const queue = new FakeQueue();
  const deps: WorkerDeps = {
    prisma: db(),
    provider,
    queue,
    env: {
      EMAIL_FROM_TRANSACTIONAL: "Cabinet <no-reply@example.com>",
      EMAIL_FROM_MARKETING: "Cabinet News <news@example.com>",
      TRACKING_HMAC_SECRET: "t".repeat(40),
      ADMIN_NOTIFICATION_EMAIL: "admin@example.com",
      APP_URL: "https://app.example.com",
      TZ_DISPLAY: "Africa/Abidjan",
    },
    logger: createLogger({ service: "worker-test", level: "silent" }),
    ...overrides,
  };
  return { deps, provider, queue };
}

let counter = 0;
export function createUser(role: "ADMIN" | "CLIENT", extra: { disabledAt?: Date } = {}) {
  counter += 1;
  return db().user.create({
    data: { email: `user${counter}@example.com`, name: `User ${counter}`, role, ...extra },
  });
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("waitFor: condition not met in time");
}
