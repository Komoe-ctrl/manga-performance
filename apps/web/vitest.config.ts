import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://manga:manga_dev_password@localhost:5434/manga_test";
const long = (c: string) => c.repeat(40);

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    // Integration tests share one PostgreSQL database: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      TEST_DATABASE_URL: testDatabaseUrl,
      DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: long("a"),
      APP_URL: "http://localhost:3000",
      BREVO_API_KEY: "test",
      BREVO_WEBHOOK_SECRET: "test",
      EMAIL_FROM_TRANSACTIONAL: "Test <no-reply@example.com>",
      EMAIL_FROM_MARKETING: "Test <news@example.com>",
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "auto",
      S3_BUCKET: "test",
      S3_ACCESS_KEY: "test",
      S3_SECRET_KEY: "test",
      TURNSTILE_SECRET_KEY: "test",
      INTERNAL_API_TOKEN: long("b"),
      INTERNAL_API_HMAC_SECRET: long("c"),
      TRACKING_HMAC_SECRET: long("d"),
      ADMIN_NOTIFICATION_EMAIL: "admin@example.com",
    },
  },
});
