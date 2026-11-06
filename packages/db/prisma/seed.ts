import { resolve } from "node:path";
import { createPrismaClient } from "../src/index";

// The repository-level .env is the single source of configuration.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file (CI, production): variables come from the real environment.
}

/**
 * Initial seed, safe to run repeatedly. It never creates fake data: the dev
 * fixtures belong to `db:seed:dev` (later step). Default settings and the three
 * sequence templates arrive with steps 3, 5 and 8.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  const appUrl = process.env.APP_URL;
  if (!databaseUrl || !adminEmail || !appUrl) {
    throw new Error("DATABASE_URL, ADMIN_NOTIFICATION_EMAIL and APP_URL are required.");
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    const { createTokenStore } = await import("../src/auth-tokens");
    const { AUTH_POLICY } = await import("@manga/core");

    if ((await prisma.user.count({ where: { role: "ADMIN" } })) > 0) {
      console.log("An admin already exists: nothing to do.");
      return;
    }
    const admin = await prisma.user.create({
      data: { email: adminEmail.toLowerCase(), name: "Consultant", role: "ADMIN" },
    });
    const { token } = await createTokenStore(prisma).issue(
      "invite",
      admin.id,
      AUTH_POLICY.invitationTtlMs,
    );
    const url = `${appUrl.replace(/\/$/, "")}/invitation?token=${encodeURIComponent(token)}`;
    console.log(`Admin created for ${adminEmail}.`);
    console.log("Open this single-use link within 72 hours to set the password and enrol 2FA:");
    console.log(`  ${url}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
