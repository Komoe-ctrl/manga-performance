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
      // MinIO from infra/docker-compose.dev.yml (a CI service container in GitHub Actions).
      S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "http://localhost:9100",
      S3_REGION: "us-east-1",
      S3_BUCKET: process.env.TEST_S3_BUCKET ?? "manga-test",
      S3_ACCESS_KEY: process.env.TEST_S3_ACCESS_KEY ?? "manga",
      S3_SECRET_KEY: process.env.TEST_S3_SECRET_KEY ?? "manga_dev_password",
      TURNSTILE_SECRET_KEY: "test",
      INTERNAL_API_TOKEN: long("b"),
      INTERNAL_API_HMAC_SECRET: long("c"),
      TRACKING_HMAC_SECRET: long("d"),
      ADMIN_NOTIFICATION_EMAIL: "admin@example.com",
    },
  },
});
