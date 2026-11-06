import type { Logger } from "@manga/core";
import type { PrismaClient } from "@manga/db";
import type { JobQueue } from "@manga/db/queue";
import type { EmailProvider } from "@manga/emails";

export interface WorkerEnv {
  EMAIL_FROM_TRANSACTIONAL: string;
  ADMIN_NOTIFICATION_EMAIL: string;
  APP_URL: string;
  TZ_DISPLAY: string;
}

/** Everything a job handler needs, injected so handlers can be tested without pg-boss. */
export interface WorkerDeps {
  prisma: PrismaClient;
  provider: EmailProvider;
  queue: Pick<JobQueue, "enqueueEmail" | "enqueueFanout">;
  env: WorkerEnv;
  logger: Logger;
  now?: () => Date;
}
