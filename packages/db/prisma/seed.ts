import { resolve } from "node:path";
import { AUTH_POLICY } from "@manga/core";
import { textToTiptap } from "@manga/core/rich-text";
import { SEQUENCE_TEMPLATES } from "@manga/emails/sequence-templates";
import { createTokenStore } from "../src/auth-tokens";
import { createPrismaClient, type PrismaClient } from "../src/index";

// The repository-level .env is the single source of configuration.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file (CI, production): variables come from the real environment.
}

/** First admin: password and 2FA are defined at the first login, through a 72 h single-use link. */
async function seedAdmin(prisma: PrismaClient, adminEmail: string, appUrl: string) {
  if ((await prisma.user.count({ where: { role: "ADMIN" } })) > 0) {
    console.log("An admin already exists: skipped.");
    return;
  }
  const admin = await prisma.user.create({
    data: { email: adminEmail.toLowerCase(), name: "Consultant", role: "ADMIN" },
  });
  const { token } = await createTokenStore(prisma).issue("invite", admin.id, AUTH_POLICY.invitationTtlMs);
  const url = `${appUrl.replace(/\/$/, "")}/invitation?token=${encodeURIComponent(token)}`;
  console.log(`Admin created for ${adminEmail}.`);
  console.log("Open this single-use link within 72 hours to set the password and enrol 2FA:");
  console.log(`  ${url}`);
}

/** The three template sequences. Inactive: the consultant reviews them first. Skipped once any sequence exists. */
async function seedSequences(prisma: PrismaClient) {
  if ((await prisma.emailSequence.count()) > 0) {
    console.log("Email sequences already exist: skipped.");
    return;
  }
  for (const template of SEQUENCE_TEMPLATES) {
    await prisma.emailSequence.create({
      data: {
        name: template.name,
        trigger: template.trigger === "inscription_newsletter" ? "NEWSLETTER_SIGNUP" : "MANUAL",
        active: false,
        steps: {
          create: template.steps.map((step, index) => ({
            order: index + 1,
            delayDays: step.delayDays,
            subject: step.subject,
            bodyJson: textToTiptap(step.body) as object,
          })),
        },
      },
    });
  }
  console.log(`${SEQUENCE_TEMPLATES.length} template email sequences created (inactive).`);
}

/**
 * Initial seed, safe to run repeatedly. It never creates fake data: the dev fixtures belong
 * to `db:seed:dev` (later step). Default settings live in the code and need no seeding.
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
    await seedAdmin(prisma, adminEmail, appUrl);
    await seedSequences(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
