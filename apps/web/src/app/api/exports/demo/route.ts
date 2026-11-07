import { connection } from "next/server";
import { LIMITS, RateLimitError, clientIp, consume } from "@/server/auth/rate-limit";
import { buildDemoExport, parseDemoFilters } from "@/server/exports/demo";
import { datedName } from "@/server/exports/format";
import { streamPdf } from "@/server/exports/pdf";
import { streamXlsx } from "@/server/exports/xlsx";

/**
 * `GET /api/exports/demo?format=xlsx|pdf&hotelId&productId&granularity` (spec, 6.9).
 * Public, because the demonstration page is: it only ever contains the fictitious dataset
 * shipped with the app, never a record. Rate limited per IP so it cannot be used to burn CPU.
 */
export async function GET(request: Request) {
  await connection();
  try {
    await consume(LIMITS.demoExportIp, clientIp(request.headers));
  } catch (error) {
    if (error instanceof RateLimitError) {
      return Response.json(
        { error: "RATE_LIMITED", message: "Trop d'exports, réessayez plus tard." },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }

  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "xlsx";
  if (format !== "xlsx" && format !== "pdf") {
    return Response.json({ error: "INVALID", message: "Format inconnu." }, { status: 400 });
  }
  let table;
  try {
    table = buildDemoExport(parseDemoFilters(params));
  } catch {
    return Response.json({ error: "INVALID", message: "Filtres invalides." }, { status: 400 });
  }

  const now = new Date();
  const body = format === "xlsx" ? streamXlsx(table, now) : await streamPdf(table, now);
  return new Response(body, {
    headers: {
      "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
      "Content-Disposition": `attachment; filename="${datedName(table.slug, now)}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
