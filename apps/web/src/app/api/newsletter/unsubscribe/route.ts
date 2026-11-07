import { connection } from "next/server";
import { getEnv } from "@manga/core/env";
import { getNewsletter } from "@/server/marketing/instance";
import { handleUnsubscribe } from "@/server/marketing/newsletter-handlers";

const deps = () => ({ newsletter: getNewsletter(), secret: getEnv().TRACKING_HMAC_SECRET });

/** Public, signed link. GET shows a confirmation button. */
export async function GET(request: Request) {
  await connection();
  return handleUnsubscribe(request, deps());
}

/** The button, or a mail client's one-click request (RFC 8058). */
export async function POST(request: Request) {
  return handleUnsubscribe(request, deps());
}
