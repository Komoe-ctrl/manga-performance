import { createLogger } from "@manga/core";
import type { PrismaClient } from "@manga/db";
import { recordAudit } from "../repositories/audit";
import { createExportDatasets, parseFilters } from "./datasets";
import { datedName } from "./format";
import { streamPdf } from "./pdf";
import { EXPORT_FORMATS, EXPORT_KINDS, ExportError, MAX_PDF_ROWS, type ExportFormat, type ExportKind, type ExportTable } from "./types";
import { streamXlsx } from "./xlsx";

const logger = createLogger({ service: "web" });

const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const isKind = (value: string): value is ExportKind => (EXPORT_KINDS as readonly string[]).includes(value);
const isFormat = (value: string): value is ExportFormat => (EXPORT_FORMATS as readonly string[]).includes(value);

const STATUS_BY_CODE = { INVALID: 400, NOT_FOUND: 404, TOO_LARGE: 413 } as const;

export interface ExportRequest {
  kind: string;
  searchParams: URLSearchParams;
  actorId: string;
  ip?: string | null;
  now?: Date;
}

/**
 * Spec, 6.11: re-applies the filters server side, streams the file, and journals the export.
 * Authorization is the caller's job (`requireAdmin()` in the route) and happens before this.
 */
export async function handleExport(prisma: PrismaClient, request: ExportRequest): Promise<Response> {
  const now = request.now ?? new Date();
  try {
    if (!isKind(request.kind)) throw new ExportError("NOT_FOUND", "Export inconnu.");
    const format = request.searchParams.get("format") ?? "xlsx";
    if (!isFormat(format)) throw new ExportError("INVALID", "Format inconnu.");

    const datasets = createExportDatasets(prisma);
    let table: ExportTable;
    let filters: Record<string, string | undefined>;
    switch (request.kind) {
      case "prospects": {
        const parsed = parseFilters("prospects", request.searchParams);
        filters = parsed;
        table = await datasets.prospects(parsed);
        break;
      }
      case "invoices": {
        const parsed = parseFilters("invoices", request.searchParams);
        filters = parsed;
        table = await datasets.invoices(parsed);
        break;
      }
      case "subscribers": {
        const parsed = parseFilters("subscribers", request.searchParams);
        filters = parsed;
        table = await datasets.subscribers(parsed);
        break;
      }
      case "scrape-results": {
        const parsed = parseFilters("scrape-results", request.searchParams);
        filters = parsed;
        table = await datasets.scrapeResults(parsed);
        break;
      }
    }
    if (format === "pdf" && table.rows.length > MAX_PDF_ROWS) {
      throw new ExportError("TOO_LARGE", `Un PDF est limité à ${MAX_PDF_ROWS} lignes : affinez les filtres ou choisissez Excel.`);
    }

    // Journal first: if the file cannot be produced, the attempt is still on record.
    await recordAudit(prisma, {
      actorId: request.actorId,
      action: "export.generated",
      entity: "Export",
      entityId: request.kind,
      diff: { format, rows: table.rows.length, filters: filters as Record<string, string> },
      ip: request.ip,
    });

    const body = format === "xlsx" ? streamXlsx(table, now) : await streamPdf(table, now);
    return new Response(body, {
      headers: {
        "Content-Type": CONTENT_TYPES[format],
        "Content-Disposition": `attachment; filename="${datedName(table.slug, now)}.${format}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportError) {
      return Response.json({ error: error.code, message: error.message }, { status: STATUS_BY_CODE[error.code] });
    }
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "export failed");
    return Response.json({ error: "INTERNAL" }, { status: 500 });
  }
}
