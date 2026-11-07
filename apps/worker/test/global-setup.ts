import { execSync } from "node:child_process";
import { resolve } from "node:path";

/** Generates the Prisma client and migrates the dedicated test database (never the dev one). */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://manga:manga_dev_password@localhost:5434/manga_test";
  if (!/manga_test/.test(url)) {
    throw new Error("Refusing to run integration tests: TEST_DATABASE_URL must target manga_test.");
  }
  const options = {
    cwd: resolve(import.meta.dirname, "../../../packages/db"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe" as const,
  };
  execSync("npx --no-install prisma generate", options);
  execSync("npx --no-install prisma migrate deploy", options);
}
