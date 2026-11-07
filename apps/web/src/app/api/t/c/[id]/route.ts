import { connection } from "next/server";
import { getEnv } from "@manga/core/env";
import { getPrisma } from "@/server/db";
import { recordClick } from "@/server/marketing/tracking";

/** Click tracking: records the click, then redirects to the signed destination. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const destination = await recordClick(getPrisma(), id, getEnv().TRACKING_HMAC_SECRET).catch(() => null);
  if (!destination) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: destination, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
