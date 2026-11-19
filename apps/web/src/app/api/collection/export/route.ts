import { getEnv } from "@manga/core/env";
import { connection } from "next/server";
import { authErrorResponse, requireAdminOrClient } from "@/server/auth/guards";
import { createExportService, type ExportFilters } from "@/server/collection/export-service";
import { getPrisma } from "@/server/db";
import { DomainError } from "@/server/domain-error";
import { getStorage } from "@/server/storage/object-storage";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const FILTER_LIMIT = 80;
const param = (params: URLSearchParams, name: string) => {
  const value = params.get(name)?.trim();
  return value ? value.slice(0, FILTER_LIMIT) : undefined;
};

/**
 * `GET /api/collection/export?templateId=&from=AAAA-MM&to=AAAA-MM[&clientId=&sector=&entityId=][&format=zip]`
 * (avenant n°1, §8). Excel consolidé par défaut, ZIP des fichiers originaux avec `format=zip`. Les
 * filtres ne s'ajoutent qu'à l'`entityScope` de la session : ils ne peuvent jamais l'élargir.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const session = await requireAdminOrClient();
    const params = new URL(request.url).searchParams;
    const filters: ExportFilters = {
      templateId: param(params, "templateId") ?? "",
      from: param(params, "from") ?? "",
      to: param(params, "to") ?? param(params, "from") ?? "",
      clientId: param(params, "clientId"),
      sector: param(params, "sector"),
      entityId: param(params, "entityId"),
    };
    const actor = { userId: session.userId, role: session.role, clientId: session.clientId ?? null };
    const service = createExportService({ prisma: getPrisma(), storage: getStorage(getEnv()) });

    const zip = params.get("format") === "zip";
    const { buffer, filename } = zip ? await service.exportOriginals(actor, filters) : await service.exportWorkbook(actor, filters);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": zip ? "application/zip" : XLSX,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof DomainError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "VALIDATION" || error.code === "TOO_LARGE" ? 400 : 404;
      return Response.json({ error: error.code, message: error.message }, { status });
    }
    throw error;
  }
}
