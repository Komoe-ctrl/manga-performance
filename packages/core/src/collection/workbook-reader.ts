import ExcelJS from "exceljs";
import { inspectXlsxArchive } from "./archive";
import { isBlank } from "./cells";
import { META_SHEET, readMeta, type MetaStatus } from "./meta";
import { matchHeaders } from "./engine";
import type { InputRow, Issue, RawCell, SheetInput, TemplateDef } from "./types";

/** Garde-fous de lecture (avenant n°1, §7). */
export interface ReadLimits {
  maxRows: number;
  maxColumns: number;
  timeoutMs: number;
}
export const DEFAULT_READ_LIMITS: ReadLimits = { maxRows: 50_000, maxColumns: 100, timeoutMs: 30_000 };

/** Fichier refusé avant tout contrôle de contenu (format, macros, bombe, dépassement de limites). */
export class WorkbookGuardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkbookGuardError";
  }
}

export interface WorkbookCells {
  sheets: Record<string, SheetInput>;
  issues: Issue[];
  meta: MetaStatus;
}

const issue = (severity: Issue["severity"], sheet: string, row: number | null, code: string, message: string): Issue => ({ severity, sheet, row, column: null, columnLabel: null, value: null, code, message });

/** Valeur lisible d'une cellule : la valeur **calculée** des formules, le texte des cellules riches ou liées. */
function plain(value: ExcelJS.CellValue): { value: RawCell; formulaWithoutResult: boolean } {
  if (value === null || value === undefined) return { value: null, formulaWithoutResult: false };
  if (value instanceof Date || typeof value === "number" || typeof value === "string" || typeof value === "boolean") return { value, formulaWithoutResult: false };
  if ("error" in value) return { value: String(value.error), formulaWithoutResult: false };
  if ("richText" in value) return { value: value.richText.map((part) => part.text).join(""), formulaWithoutResult: false };
  if ("formula" in value || "sharedFormula" in value) {
    const result = (value as { result?: ExcelJS.CellValue }).result;
    if (result === undefined || result === null) return { value: null, formulaWithoutResult: true };
    return { ...plain(result as ExcelJS.CellValue), formulaWithoutResult: false };
  }
  if ("text" in value) return { value: String(value.text), formulaWithoutResult: false };
  return { value: null, formulaWithoutResult: false };
}

/**
 * Lit un classeur `.xlsx` et le met au format du moteur de contrôle : cellules indexées par clé de
 * colonne, numéros de ligne du fichier. Les en-têtes sont vérifiés ici.
 *
 * Garde-fous : archive réellement décompressée sous budget avant tout (`inspectXlsxArchive`, ≤ 50 Mo),
 * puis au plus `maxRows` lignes et `maxColumns` colonnes par feuille, délai `timeoutMs`. Un dépassement
 * lève `WorkbookGuardError`.
 *
 * Lecture en mémoire plutôt qu'en flux : le lecteur en flux d'exceljs plante sur les fichiers dont
 * `workbook.xml` suit les feuilles dans l'archive (cas courant selon l'éditeur). Le budget de 50 Mo
 * garantit que la mémoire reste bornée.
 */
export async function readWorkbookCells(buffer: Uint8Array, template: TemplateDef, secret: string, limits: ReadLimits = DEFAULT_READ_LIMITS): Promise<WorkbookCells> {
  const archive = inspectXlsxArchive(buffer);
  if (!archive.ok) throw new WorkbookGuardError(archive.code, archive.message);

  const wb = new ExcelJS.Workbook();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      wb.xlsx.load(buffer as unknown as ArrayBuffer),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WorkbookGuardError("TIMEOUT", "Le contrôle du fichier a pris trop de temps : il est refusé.")), limits.timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof WorkbookGuardError) throw error;
    throw new WorkbookGuardError("UNREADABLE", "Le fichier est illisible ou endommagé : impossible de l'ouvrir comme classeur .xlsx.");
  } finally {
    clearTimeout(timer);
  }

  const issues: Issue[] = [];
  const sheets: Record<string, SheetInput> = {};

  const metaSheet = wb.getWorksheet(META_SHEET);
  const signatureRow = metaSheet ? Array.from({ length: Math.min(metaSheet.rowCount, 50) }, (_, i) => metaSheet.getRow(i + 1)).find((r) => plain(r.getCell(1).value).value === "signature") : undefined;
  const token = signatureRow ? plain(signatureRow.getCell(2).value).value : null;
  const meta = readMeta(typeof token === "string" ? token : null, secret);

  const started = Date.now();
  for (const def of template.sheets) {
    const ws = wb.getWorksheet(def.name);
    if (!ws) continue; // The engine reports the missing sheet.
    if (ws.rowCount > limits.maxRows) throw new WorkbookGuardError("TOO_MANY_ROWS", `La feuille « ${def.name} » dépasse ${limits.maxRows.toLocaleString("fr-FR")} lignes : fichier refusé.`);
    if (ws.columnCount > limits.maxColumns) throw new WorkbookGuardError("TOO_MANY_COLUMNS", `La feuille « ${def.name} » dépasse ${limits.maxColumns} colonnes : fichier refusé.`);

    const headers: string[] = [];
    const headerRow = ws.getRow(1);
    for (let c = 1; c <= Math.max(ws.columnCount, def.columns.length); c++) headers.push(String(plain(headerRow.getCell(c).value).value ?? ""));
    const matched = matchHeaders(def, headers);
    issues.push(...matched.issues);

    const rows: InputRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      if (Date.now() - started > limits.timeoutMs) throw new WorkbookGuardError("TIMEOUT", "Le contrôle du fichier a pris trop de temps : il est refusé.");
      const cells: Record<string, RawCell> = {};
      for (const [index, key] of Object.entries(matched.map)) {
        const { value, formulaWithoutResult } = plain(row.getCell(Number(index) + 1).value);
        cells[key] = value;
        if (formulaWithoutResult) {
          issues.push(issue("warning", def.name, rowNumber, "FORMULA_NO_VALUE", `Ligne ${rowNumber} : une formule n'a pas de valeur calculée (ouvrez et enregistrez le fichier dans Excel avant de le déposer).`));
        }
      }
      if (Object.values(cells).some((v) => !isBlank(v))) rows.push({ rowNumber, cells });
    });
    sheets[def.name] = rows;
  }
  return { sheets, issues, meta };
}
