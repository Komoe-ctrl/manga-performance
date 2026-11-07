import { RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible";
import { Pool } from "pg";
import { getEnv } from "@manga/core/env";

/** Thrown when a limit is exceeded. `retryAfterSeconds` is safe to expose. */
export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("RATE_LIMITED");
    this.name = "RateLimitError";
  }
}

export interface LimitRule {
  /** Unique name, used as the storage key prefix. */
  name: string;
  points: number;
  durationSeconds: number;
}

export const LIMITS = {
  loginIp: { name: "login-ip", points: 20, durationSeconds: 15 * 60 },
  loginEmail: { name: "login-email", points: 10, durationSeconds: 15 * 60 },
  twoFactorIp: { name: "2fa-ip", points: 15, durationSeconds: 15 * 60 },
  resetIp: { name: "reset-ip", points: 5, durationSeconds: 60 * 60 },
  resetEmail: { name: "reset-email", points: 3, durationSeconds: 60 * 60 },
  tokenIp: { name: "token-ip", points: 20, durationSeconds: 60 * 60 },
  /** Public forms: 5 per hour per IP (spec, section 5). */
  leadIp: { name: "lead-ip", points: 5, durationSeconds: 60 * 60 },
  /** Each signed internal request may be seen once: a replayed signature is refused (10 minutes > the 5 minute window). */
  internalReplay: { name: "internal-replay", points: 1, durationSeconds: 10 * 60 },
  /** Public demo exports (fictitious data): cheap to serve but not free. */
  demoExportIp: { name: "demo-export-ip", points: 20, durationSeconds: 60 * 60 },
  newsletterIp: { name: "newsletter-ip", points: 5, durationSeconds: 60 * 60 },
  /** Stops someone being mail-bombed with confirmation emails. */
  newsletterEmail: { name: "newsletter-email", points: 3, durationSeconds: 60 * 60 },
} as const satisfies Record<string, LimitRule>;

const globalForLimiter = globalThis as unknown as {
  rateLimitPool?: Pool;
  rateLimiters?: Map<string, RateLimiterPostgres>;
};

function limiterFor(rule: LimitRule): RateLimiterPostgres {
  globalForLimiter.rateLimitPool ??= new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 });
  globalForLimiter.rateLimiters ??= new Map();
  let limiter = globalForLimiter.rateLimiters.get(rule.name);
  if (!limiter) {
    limiter = new RateLimiterPostgres({
      storeClient: globalForLimiter.rateLimitPool,
      tableName: "rate_limiter",
      tableCreated: true, // created by the Prisma migration
      keyPrefix: rule.name,
      points: rule.points,
      duration: rule.durationSeconds,
    });
    globalForLimiter.rateLimiters.set(rule.name, limiter);
  }
  return limiter;
}

/** Consumes one point for `key`; throws `RateLimitError` once the rule is exhausted. */
export async function consume(rule: LimitRule, key: string): Promise<void> {
  try {
    await limiterFor(rule).consume(key);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      throw new RateLimitError(Math.max(1, Math.ceil(error.msBeforeNext / 1000)));
    }
    throw error;
  }
}

/** First address of `x-forwarded-for` (set by Caddy), falling back to a constant bucket. */
export function clientIp(headers: Headers | null | undefined): string {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip")?.trim() || "unknown";
}

/** Test helper. */
export async function closeRateLimitPool(): Promise<void> {
  await globalForLimiter.rateLimitPool?.end();
  globalForLimiter.rateLimitPool = undefined;
  globalForLimiter.rateLimiters = undefined;
}
