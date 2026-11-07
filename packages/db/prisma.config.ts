import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

// The repository-level .env is the single source of configuration.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch {
  // No .env file (CI, production): variables come from the real environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
