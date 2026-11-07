import { z } from "zod";

const secret = z.string().min(32, "must be at least 32 characters");
const nonEmpty = z.string().min(1);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Front mocks stay available until the end of step 4 (see spec, section 0).
  DATA_SOURCE: z.enum(["mock", "db"]).default("mock"),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: secret,
  APP_URL: z.url(),

  EMAIL_PROVIDER: z.enum(["brevo", "resend"]).default("brevo"),
  BREVO_API_KEY: nonEmpty,
  BREVO_WEBHOOK_SECRET: nonEmpty,
  EMAIL_FROM_TRANSACTIONAL: nonEmpty,
  EMAIL_FROM_MARKETING: nonEmpty,

  S3_ENDPOINT: z.url(),
  S3_REGION: nonEmpty,
  S3_BUCKET: nonEmpty,
  S3_ACCESS_KEY: nonEmpty,
  S3_SECRET_KEY: nonEmpty,
  /** Where public/blog/* is served from. Defaults to the endpoint and bucket. */
  // Docker Compose passes unset variables as empty strings: empty means "not set".
  S3_PUBLIC_URL: z.preprocess((value) => (value === "" ? undefined : value), z.url().optional()),

  TURNSTILE_SECRET_KEY: nonEmpty,
  INTERNAL_API_TOKEN: secret,
  INTERNAL_API_HMAC_SECRET: secret,
  TRACKING_HMAC_SECRET: secret,

  ADMIN_NOTIFICATION_EMAIL: z.email(),
  TZ_DISPLAY: z.string().default("Africa/Abidjan"),
});

export type Env = z.infer<typeof envSchema>;

/** Markers used by `.env.example` and the dev compose file: refused in production. */
const PLACEHOLDERS = ["change-me", "manga_dev_password"];
const TURNSTILE_TEST_SECRET = /^[123]x0{4}/;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/**
 * Validates an environment source. Throws `EnvError` listing the offending
 * variable names — never their values, which may be secrets.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  const env = result.data;
  if (env.NODE_ENV === "production") {
    const placeholders = Object.entries(env)
      .filter(([, value]) => typeof value === "string" && PLACEHOLDERS.some((p) => value.includes(p)))
      .map(([key]) => `${key}: placeholder value is not allowed in production`);
    // Cloudflare's public test keys always pass: they would disable the anti-spam in production.
    if (TURNSTILE_TEST_SECRET.test(env.TURNSTILE_SECRET_KEY)) {
      placeholders.push("TURNSTILE_SECRET_KEY: Cloudflare test key is not allowed in production");
    }
    if (placeholders.length > 0) throw new EnvError(placeholders);
  }
  return env;
}

let cached: Env | undefined;

/** Validated environment, parsed once per process. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
