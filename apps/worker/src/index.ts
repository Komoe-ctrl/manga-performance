import { resolve } from "node:path";
import { createLogger, getEnv } from "@manga/core";
import { createPrismaClient } from "@manga/db";
import { createJobQueue } from "@manga/db/queue";
import { QUEUES, createEmailProvider } from "@manga/emails";
import type { WorkerDeps } from "./deps";
import { runDailyDigest } from "./jobs/daily-digest";
import { handleEmailSend } from "./jobs/email-send";
import { handleFanout } from "./jobs/fanout";
import { runMarkOverdue, runPaymentReminders } from "./jobs/invoices";

// The repository-level .env is the single source of configuration.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file (CI, production): variables come from the real environment.
}

const env = getEnv();
const logger = createLogger({ service: "worker", level: env.LOG_LEVEL });
const prisma = createPrismaClient(env.DATABASE_URL);
const queue = await createJobQueue(env.DATABASE_URL, {
  worker: true,
  onError: (error) => logger.error({ errorName: error.name }, "queue error"),
});

const provider = createEmailProvider(env, {
  mailboxDirectory: resolve(import.meta.dirname, "../../../.dev-mailbox"),
});
const deps: WorkerDeps = { prisma, provider, queue, env, logger };
logger.info({ provider: provider.name }, "worker started");

const { boss } = queue;

await boss.work(QUEUES.emailSend, async (jobs) => {
  for (const job of jobs) await handleEmailSend(job.data, deps);
});
await boss.work(QUEUES.notificationsFanout, async (jobs) => {
  for (const job of jobs) await handleFanout(job, deps);
});
await boss.work(QUEUES.followupsDailyDigest, async () => {
  await runDailyDigest(deps);
});
await boss.work(QUEUES.invoicesMarkOverdue, async () => {
  await runMarkOverdue(deps);
});
await boss.work(QUEUES.invoicesPaymentReminders, async () => {
  await runPaymentReminders(deps);
});

// Daily schedules, in the cabinet timezone (spec, section 7).
const schedules: [string, string][] = [
  [QUEUES.invoicesMarkOverdue, "0 6 * * *"],
  [QUEUES.followupsDailyDigest, "0 7 * * *"],
  [QUEUES.invoicesPaymentReminders, "0 9 * * *"],
];
for (const [name, cron] of schedules) await boss.schedule(name, cron, {}, { tz: env.TZ_DISPLAY });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker stopping");
  await queue.stop();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
