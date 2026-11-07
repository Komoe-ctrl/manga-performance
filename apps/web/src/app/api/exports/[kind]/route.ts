import { connection } from "next/server";
import { authErrorResponse, requireAdmin } from "@/server/auth/guards";
import { clientIp } from "@/server/auth/rate-limit";
import { getPrisma } from "@/server/db";
import { handleExport } from "@/server/exports/handler";

/**
 * `GET /api/exports/{prospects|invoices|subscribers|scrape-results}?format=xlsx|pdf&<filters>`.
 * Admin only: authorization is checked before anything is read.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  await connection();
  try {
    const admin = await requireAdmin();
    const { kind } = await params;
    return await handleExport(getPrisma(), {
      kind,
      searchParams: new URL(request.url).searchParams,
      actorId: admin.userId,
      ip: clientIp(request.headers),
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
