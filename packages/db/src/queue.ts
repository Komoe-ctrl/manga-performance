import { createHash } from "node:crypto";
import { QUEUES, type EmailJob, type FanoutJob } from "@manga/emails/jobs";
import { PgBoss } from "pg-boss";

/**
 * Deterministic job id from a business key: sending the same key twice creates one job
 * (pg-boss ignores a duplicate id), which is what makes jobs idempotent (spec, section 7).
 */
export function jobIdFromKey(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export interface QueueDefinition {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  expireInSeconds: number;
  /** How long a job may wait for a worker before being dropped. */
  retentionSeconds: number;
  /** How long finished jobs are kept. Short: email payloads can contain single-use links. */
  deleteAfterSeconds: number;
}

const DAY = 24 * 3600;

/** 3 attempts with exponential backoff for emails (spec, section 7). */
export const QUEUE_DEFINITIONS: Record<string, QueueDefinition> = {
  [QUEUES.emailSend]: { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, retentionSeconds: 3 * DAY, deleteAfterSeconds: 3600 },
  [QUEUES.notificationsFanout]: { retryLimit: 3, retryDelay: 15, retryBackoff: true, expireInSeconds: 120, retentionSeconds: 3 * DAY, deleteAfterSeconds: 3600 },
  [QUEUES.followupsDailyDigest]: { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, retentionSeconds: DAY, deleteAfterSeconds: 3600 },
  [QUEUES.invoicesMarkOverdue]: { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, retentionSeconds: DAY, deleteAfterSeconds: 3600 },
  [QUEUES.invoicesPaymentReminders]: { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 600, retentionSeconds: DAY, deleteAfterSeconds: 3600 },
  [QUEUES.sequencesDispatch]: { retryLimit: 1, retryDelay: 60, retryBackoff: false, expireInSeconds: 600, retentionSeconds: 3600, deleteAfterSeconds: 3600 },
  [QUEUES.newsletterPurgeUnconfirmed]: { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, retentionSeconds: DAY, deleteAfterSeconds: 3600 },
};

export interface JobQueueOptions {
  /** PostgreSQL schema holding pg-boss tables. */
  schema?: string;
  /** The worker supervises queues and runs the scheduler; publishers (web) do not. */
  worker?: boolean;
  /** Overrides, for tests (e.g. a 1 second retry delay). */
  definitions?: Record<string, QueueDefinition>;
  onError?: (error: Error) => void;
}

export interface EnqueueOptions {
  /** Same key = same job: duplicates are ignored while the job exists. */
  dedupeKey?: string;
  delaySeconds?: number;
}

export interface JobQueue {
  boss: PgBoss;
  enqueueEmail(job: EmailJob, options?: EnqueueOptions): Promise<void>;
  enqueueFanout(job: FanoutJob, options?: EnqueueOptions): Promise<void>;
  stop(): Promise<void>;
}

/** Starts pg-boss (PostgreSQL-backed jobs, no Redis) and makes sure the queues exist. */
export async function createJobQueue(
  connectionString: string,
  options: JobQueueOptions = {},
): Promise<JobQueue> {
  const worker = options.worker === true;
  const boss = new PgBoss({
    connectionString,
    schema: options.schema,
    max: worker ? 8 : 2,
    supervise: worker,
    schedule: worker,
  });
  boss.on("error", (error) => options.onError?.(error));
  await boss.start();

  const definitions = options.definitions ?? QUEUE_DEFINITIONS;
  for (const [name, definition] of Object.entries(definitions)) {
    // Safe to repeat: web and worker both call this at startup.
    await boss.createQueue(name, definition);
  }

  const send = async (queue: string, data: object, { dedupeKey, delaySeconds }: EnqueueOptions = {}) => {
    await boss.send(queue, data, {
      ...(dedupeKey ? { id: jobIdFromKey(`${queue}:${dedupeKey}`) } : {}),
      ...(delaySeconds ? { startAfter: delaySeconds } : {}),
    });
  };

  return {
    boss,
    enqueueEmail: (job, opts) => send(QUEUES.emailSend, job, opts),
    enqueueFanout: (job, opts) => send(QUEUES.notificationsFanout, job, opts),
    stop: () => boss.stop({ graceful: true, timeout: 10_000 }),
  };
}
