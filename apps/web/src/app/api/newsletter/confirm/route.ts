import { connection } from "next/server";
import { getEnv } from "@manga/core/env";
import { getNewsletter } from "@/server/marketing/instance";

/** Public: the link in the confirmation email. Single use, 48 hours. */
export async function GET(request: Request) {
  await connection();
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const status = await getNewsletter().confirm(token);
  return Response.redirect(new URL(`/newsletter/confirmation?status=${status}`, getEnv().APP_URL), 302);
}
