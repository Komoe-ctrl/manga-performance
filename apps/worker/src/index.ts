import { resolve } from "node:path";
import { createLogger, getEnv } from "@manga/core";

// The repository-level .env is the single source of configuration.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file (CI, production): variables come from the real environment.
}

const env = getEnv();
const logger = createLogger({ service: "worker", level: env.LOG_LEVEL });

// pg-boss queues and scheduled jobs are registered here from step 5 onwards.
logger.info("worker started, no jobs registered yet");

const keepAlive = setInterval(() => undefined, 60_000);

function shutdown(signal: string) {
  logger.info({ signal }, "worker stopping");
  clearInterval(keepAlive);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
