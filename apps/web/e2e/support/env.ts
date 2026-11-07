/** Everything the e2e run shares: one throw-away database, a separate port and build folder. */
export const E2E_PORT = 3100;
export const BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE = "manga_e2e";
export const ADMIN_URL = process.env.E2E_ADMIN_DATABASE_URL ?? "postgresql://manga:manga_dev_password@localhost:5434/postgres";
export const DATABASE_URL = process.env.E2E_DATABASE_URL ?? `postgresql://manga:manga_dev_password@localhost:5434/${E2E_DATABASE}`;
export const ADMIN_EMAIL = "admin-e2e@example.com";
export const ADMIN_PASSWORD = "E2e-Correct-Horse-Battery-9";

const long = (c: string) => c.repeat(40);

/** Variables for the web server and the worker. Development mode: placeholders and the email mailbox are accepted. */
export const appEnv = {
  NODE_ENV: "development",
  DATA_SOURCE: "db",
  NEXT_DIST_DIR: ".next-e2e",
  LOG_LEVEL: "warn",
  DATABASE_URL,
  BETTER_AUTH_SECRET: long("e"),
  APP_URL: BASE_URL,
  EMAIL_PROVIDER: "brevo",
  BREVO_API_KEY: "change-me",
  BREVO_WEBHOOK_SECRET: "change-me",
  EMAIL_FROM_TRANSACTIONAL: "Manga <no-reply@example.com>",
  EMAIL_FROM_MARKETING: "Manga <news@example.com>",
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "http://localhost:9100",
  S3_REGION: "us-east-1",
  S3_BUCKET: process.env.TEST_S3_BUCKET ?? "manga-test",
  S3_ACCESS_KEY: process.env.TEST_S3_ACCESS_KEY ?? "manga",
  S3_SECRET_KEY: process.env.TEST_S3_SECRET_KEY ?? "manga_dev_password",
  // The Turnstile check is answered by a local stub (e2e/support/turnstile-stub.mjs): no Internet needed.
  TURNSTILE_VERIFY_URL: "http://127.0.0.1:3101/siteverify",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  INTERNAL_API_TOKEN: long("f"),
  INTERNAL_API_HMAC_SECRET: long("g"),
  TRACKING_HMAC_SECRET: long("h"),
  ADMIN_NOTIFICATION_EMAIL: ADMIN_EMAIL,
  TZ_DISPLAY: "Africa/Abidjan",
};
export const PASSWORD_FOR_CLIENT = "Client-Correct-Horse-Battery-7";
