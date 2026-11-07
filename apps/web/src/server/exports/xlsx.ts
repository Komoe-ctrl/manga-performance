import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { formatDateTime } from "./format";
import type { ExportTable } from "./types";

const NAVY = "FF1A2B4A";
const GOLD = "FFF5B700";

/**
 * Excel file, written as a stream. Text is always stored as a string cell, never as a formula:
 * a value such as `=HYPERLINK(...)` collected from a website stays inert text.
 */
export function streamXlsx(table: ExportTable, generatedAt: Date): ReadableStream<Uint8Array> {
  const pass = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true, useSharedStrings: false });
  workbook.creator = "MANGA PERFORMANCE";
  workbook.created = generatedAt;

  const sheet = workbook.addWorksheet(table.title.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = table.columns.map((column) => ({
    header: column.header,
    width: Math.round(column.width * 8 + 6),
    style:
      column.type === "money" || column.type === "int"
        ? { numFmt: "#,##0", alignment: { horizontal: "right" as const } }
        : column.type === "date"
          ? { numFmt: "dd/mm/yyyy hh:mm" }
          : {},
  }));

  const header = sheet.getRow(1);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.border = { bottom: { style: "medium", color: { argb: GOLD } } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  header.commit();

  for (const row of table.rows) {
    // Dates are written as UTC wall-clock, and Africa/Abidjan is UTC+0 all year.
    sheet.addRow(row.map((value) => (value instanceof Date ? value : value))).commit();
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } };

  // Filters used, in a second sheet: the file stays understandable once detached from the screen.
  const info = workbook.addWorksheet("Filtres");
  info.columns = [{ width: 28 }, { width: 70 }];
  info.addRow(["Export", table.title]).commit();
  info.addRow(["Généré le", formatDateTime(generatedAt)]).commit();
  info.addRow(["Lignes", table.rows.length]).commit();
  info.addRow(["Filtres", table.filterSummary.length ? table.filterSummary.join(" ; ") : "Aucun"]).commit();
  info.commit();
  sheet.commit();

  workbook.commit().catch((error) => pass.destroy(error instanceof Error ? error : new Error("xlsx failed")));
  return Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>;
}
