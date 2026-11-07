import { getEnv } from "@manga/core/env";
import { getPrisma } from "@/server/db";
import { handleEmailWebhook } from "@/server/marketing/email-webhook";

/** Provider webhook (delivered, bounce, complaint, unsubscribe). Signature checked. */
export async function POST(request: Request) {
  return handleEmailWebhook(request, { prisma: getPrisma(), secret: getEnv().BREVO_WEBHOOK_SECRET });
}
