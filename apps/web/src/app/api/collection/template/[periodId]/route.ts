import { getEnv } from "@manga/core/env";
import { connection } from "next/server";
import { authErrorResponse, requireAdminOrClient } from "@/server/auth/guards";
import { createTemplateService } from "@/server/collection/template-service";
import { getPrisma } from "@/server/db";
import { DomainError } from "@/server/domain-error";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Excel à remplir pour une période (avenant n°1, §5). Tout passe par `entityScope` : une période d'une
 * autre entité répond 404, comme une période qui n'existe pas. Le fichier est signé avec le secret de
 * jetons de la plateforme (le motif de signature est propre à la collecte).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  await connection();
  try {
    const session = await requireAdminOrClient();
    const { periodId } = await params;
    const service = createTemplateService({ prisma: getPrisma(), secret: getEnv().TRACKING_HMAC_SECRET });
    const { buffer, filename } = await service.buildForPeriod({ userId: session.userId, role: session.role, clientId: session.clientId ?? null }, periodId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": XLSX,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof DomainError) {
      return Response.json({ error: error.code }, { status: error.code === "FORBIDDEN" ? 403 : 404 });
    }
    throw error;
  }
}
