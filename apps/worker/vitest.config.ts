import { defineConfig } from "vitest/config";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://manga:manga_dev_password@localhost:5434/manga_test";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    // Integration tests share one PostgreSQL database: run files one after another.
    fileParallelism: false,
    testTimeout: 40_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: "test", LOG_LEVEL: "silent", TEST_DATABASE_URL: testDatabaseUrl },
  },
});
