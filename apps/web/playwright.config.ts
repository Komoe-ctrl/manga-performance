import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, E2E_PORT, appEnv } from "./e2e/support/env";

/**
 * End-to-end scenarios (spec, section 10) against the real stack: Next.js in `DATA_SOURCE=db`,
 * the worker, PostgreSQL and MinIO from `infra/docker-compose.dev.yml`, on a throw-away
 * database. Run with `pnpm e2e` (needs `pnpm db:up`).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 45_000 },
  // One database, scenarios in order: no parallelism.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, actionTimeout: 45_000, navigationTimeout: 60_000, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "fr-FR" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.state/admin.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    { command: "node e2e/support/turnstile-stub.mjs", port: 3101, reuseExistingServer: false },
    {
      command: `npx next dev --port ${E2E_PORT}`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: appEnv,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
    {
      command: "npx tsx src/index.ts",
      cwd: "../worker",
      wait: { stdout: /worker started/ },
      reuseExistingServer: false,
      // The readiness line is logged at info level.
      env: { ...appEnv, LOG_LEVEL: "info" },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
  ],
});
