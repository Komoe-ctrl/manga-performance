import { createLogger } from "@manga/core";
import { getEnv } from "@manga/core/env";
import { createJobQueue, type JobQueue } from "@manga/db/queue";

/** What the web app needs from the job queue: enqueue only (the worker does the work). */
export type Enqueuer = Pick<JobQueue, "enqueueEmail" | "enqueueFanout">;

const logger = createLogger({ service: "web" });
const globalForQueue = globalThis as unknown as { jobQueue?: Promise<JobQueue> };

/** Shared pg-boss publisher, started on first use. */
export function getEnqueuer(): Promise<Enqueuer> {
  globalForQueue.jobQueue ??= createJobQueue(getEnv().DATABASE_URL, {
    onError: (error) => logger.error({ errorName: error.name }, "queue error"),
  });
  return globalForQueue.jobQueue;
}
