// Runs before Playwright (`pnpm e2e`): Playwright starts its web servers before any global setup,
// and the worker needs the database to exist. Plain JavaScript on purpose: no loader needed.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const DATABASE = "manga_e2e";
const ADMIN_URL = process.env.E2E_ADMIN_DATABASE_URL ?? "postgresql://manga:manga_dev_password@localhost:5434/postgres";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? `postgresql://manga:manga_dev_password@localhost:5434/${DATABASE}`;
const ADMIN_EMAIL = "admin-e2e@example.com";
const APP_URL = "http://localhost:3100";

// A brand-new database for every run: migrated, then seeded exactly as production would be.
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DATABASE}`);
await admin.end();

const dbDir = resolve(here, "../../../packages/db");
const env = { ...process.env, DATABASE_URL, ADMIN_NOTIFICATION_EMAIL: ADMIN_EMAIL, APP_URL };
execSync("npx --no-install prisma migrate deploy", { cwd: dbDir, env, stdio: "pipe" });
const seeded = execSync("npx --no-install tsx prisma/seed.ts", { cwd: dbDir, env, encoding: "utf8" });

const invitation = seeded.match(/https?:\/\/\S+\/invitation\?token=\S+/)?.[0];
if (!invitation) throw new Error("The seed did not print an invitation link");
mkdirSync(resolve(here, ".state"), { recursive: true });
writeFileSync(resolve(here, ".state/admin-invitation.txt"), invitation);

// The worker writes emails here instead of sending them.
const mailbox = resolve(here, "../../../.dev-mailbox");
rmSync(mailbox, { recursive: true, force: true });
mkdirSync(mailbox, { recursive: true });
console.log("e2e: database ready, admin invitation saved");
