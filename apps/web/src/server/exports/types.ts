/** A cell value. Dates are real dates (Excel keeps them sortable); the PDF formats them. */
export type Cell = string | number | Date | null;

export interface ExportColumn {
  header: string;
  /** Relative width, used by the PDF layout and (x 1.2) as the Excel column width. */
  width: number;
  /** `money` = FCFA integer, `int` = plain integer, `date` = date and time in Africa/Abidjan. */
  type?: "text" | "int" | "money" | "date";
}

/** One dataset, ready to be written to any format: both Excel and PDF read this same table. */
export interface ExportTable {
  /** File name base and sheet name. */
  slug: string;
  title: string;
  /** Human sentences describing the filters that were applied. */
  filterSummary: string[];
  columns: ExportColumn[];
  rows: Cell[][];
}

export const EXPORT_KINDS = ["prospects", "invoices", "subscribers", "scrape-results"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_FORMATS = ["xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Above this the export is refused: ask for narrower filters. */
export const MAX_EXPORT_ROWS = 20_000;
/** A PDF this long is not readable anyway; Excel is the format for big extracts. */
export const MAX_PDF_ROWS = 2_000;

export class ExportError extends Error {
  constructor(
    public readonly code: "INVALID" | "NOT_FOUND" | "TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}
