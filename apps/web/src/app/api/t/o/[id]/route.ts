import { connection } from "next/server";
import { getEnv } from "@manga/core/env";
import { getPrisma } from "@/server/db";
import { recordOpen } from "@/server/marketing/tracking";
import { TRANSPARENT_GIF } from "@/server/marketing/tracking";

/** Open-tracking pixel. Always answers with the image: a bad id must not reveal anything. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  try {
    await recordOpen(getPrisma(), id, getEnv().TRACKING_HMAC_SECRET);
  } catch {
    // Tracking is best effort: never break the email for it.
  }
  return new Response(new Uint8Array(TRANSPARENT_GIF), {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Content-Length": String(TRANSPARENT_GIF.length) },
  });
}
