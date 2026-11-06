import { beforeEach, describe, expect, it } from "vitest";
import { EnvError, getEnv, parseEnv, resetEnvCache } from "../src/env";

const long = (c: string) => c.repeat(40);

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5434/db",
  BETTER_AUTH_SECRET: long("a"),
  APP_URL: "http://localhost:3000",
  BREVO_API_KEY: "key",
  BREVO_WEBHOOK_SECRET: "whsec",
  EMAIL_FROM_TRANSACTIONAL: "Cabinet <no-reply@example.com>",
  EMAIL_FROM_MARKETING: "Cabinet <news@example.com>",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "auto",
  S3_BUCKET: "bucket",
  S3_ACCESS_KEY: "access",
  S3_SECRET_KEY: "secret",
  TURNSTILE_SECRET_KEY: "turnstile",
  INTERNAL_API_TOKEN: long("b"),
  INTERNAL_API_HMAC_SECRET: long("c"),
  TRACKING_HMAC_SECRET: long("d"),
  ADMIN_NOTIFICATION_EMAIL: "admin@example.com",
};

describe("parseEnv", () => {
  it("accepts a complete configuration and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.DATA_SOURCE).toBe("mock");
    expect(env.EMAIL_PROVIDER).toBe("brevo");
    expect(env.TZ_DISPLAY).toBe("Africa/Abidjan");
  });

  it("fails when a variable is missing and names it without leaking values", () => {
    const rest = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "DATABASE_URL"));
    try {
      parseEnv({ ...rest, BETTER_AUTH_SECRET: "short-secret-value" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("BETTER_AUTH_SECRET");
      expect(message).not.toContain("short-secret-value");
    }
  });

  it("rejects a non-postgres database url", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://u:p@h/db" })).toThrow(EnvError);
  });

  it("rejects placeholder values in production only", () => {
    const placeholder = { ...valid, BREVO_API_KEY: "change-me" };
    expect(() => parseEnv(placeholder)).not.toThrow();
    expect(() => parseEnv({ ...placeholder, NODE_ENV: "production" })).toThrow(
      /BREVO_API_KEY: placeholder/,
    );
  });
});

describe("getEnv", () => {
  beforeEach(() => resetEnvCache());

  it("parses process.env once and caches the result", () => {
    const previous = { ...process.env };
    Object.assign(process.env, valid);
    try {
      const first = getEnv();
      expect(getEnv()).toBe(first);
    } finally {
      for (const key of Object.keys(valid)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });
});
