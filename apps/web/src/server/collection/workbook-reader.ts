import ExcelJS from "exceljs";
import { isBlank, matchHeaders, type InputRow, type Issue, type RawCell, type SheetInput, type TemplateDef } from "@manga/core/collection";
import { META_SHEET, readMeta, type MetaStatus } from "./template-meta";

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
 * Lit un classeur `.xlsx` et le met au format attendu par le moteur de contrôle : cellules indexées
 * par clé de colonne, numéros de ligne du fichier. Les en-têtes sont vérifiés ici.
 *
 * Lecture complète en mémoire : les garde-fous (taille, nombre de lignes et de colonnes, délai,
 * lecture en flux) enveloppent cette fonction à l'étape du dépôt.
 */
export async function readWorkbookCells(buffer: Buffer | ArrayBuffer, template: TemplateDef, secret: string): Promise<WorkbookCells> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);

  const issues: Issue[] = [];
  const sheets: Record<string, SheetInput> = {};

  const metaSheet = wb.getWorksheet(META_SHEET);
  const token = metaSheet ? plain(metaSheet.getCell("B5").value).value : null;
  const meta = readMeta(typeof token === "string" ? token : null, secret);

  for (const def of template.sheets) {
    const ws = wb.getWorksheet(def.name);
    if (!ws) continue; // The engine reports the missing sheet.

    const headers: string[] = [];
    const headerRow = ws.getRow(1);
    for (let c = 1; c <= Math.max(ws.columnCount, def.columns.length); c++) headers.push(String(plain(headerRow.getCell(c).value).value ?? ""));
    const { map, issues: headerIssues } = matchHeaders(def, headers);
    issues.push(...headerIssues);

    const rows: InputRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells: Record<string, RawCell> = {};
      for (const [index, key] of Object.entries(map)) {
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
