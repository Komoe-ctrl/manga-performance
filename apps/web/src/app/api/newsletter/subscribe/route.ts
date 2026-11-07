import { getEnv } from "@manga/core/env";
import { getNewsletter } from "@/server/marketing/instance";
import { handleSubscribe } from "@/server/marketing/newsletter-handlers";

/** Public: start a newsletter subscription (double opt-in). */
export async function POST(request: Request) {
  return handleSubscribe(request, { newsletter: getNewsletter(), env: getEnv() });
}
