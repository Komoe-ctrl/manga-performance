import ExcelJS from "exceljs";
import { daysInPeriod, formatDateFr } from "./cells";
import { META_SHEET, signMeta } from "./meta";
import type { ColumnDef, PeriodContext, SheetDef, TemplateDef } from "./types";

const NAVY = "FF1A2B4A";
const GOLD = "FFF5B700";
const LISTS_SHEET = "_lists";
/** Nombre de lignes de saisie préparées (validations de données) pour une feuille à lignes multiples. */
export const MAX_ENTRY_ROWS = 300;
/** Excel refuse une liste en ligne de plus de 255 caractères. */
const INLINE_LIST_LIMIT = 250;

export interface TemplateBuildInput {
  template: TemplateDef;
  entity: { id: string; name: string };
  period: { id: string; start: Date; end: Date; dueAt: Date };
  /** Listes du client (catalogue produits, unités), pour les listes déroulantes. */
  options?: PeriodContext["options"];
  /** Valeurs pré-remplies sur la première ligne, par feuille puis par clé de colonne. */
  prefill?: Record<string, Record<string, string | number>>;
  secret: string;
  generatedAt?: Date;
}

/** exceljs converts `Date` bounds to Excel serials itself; passing a raw serial would be read as milliseconds. */
const dayBound = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const NUM_FORMAT: Partial<Record<ColumnDef["kind"], string>> = {
  integer: "0",
  decimal: "#,##0.00##",
  amount: '#,##0 "FCFA"',
  percent: '0.0" %"',
  date: "dd/mm/yyyy",
};

const KIND_LABEL: Record<ColumnDef["kind"], string> = {
  text: "texte",
  enum: "liste de valeurs",
  integer: "nombre entier",
  decimal: "nombre décimal",
  amount: "montant entier en FCFA",
  percent: "pourcentage de 0 à 100 (une décimale)",
  date: "date JJ/MM/AAAA",
};

function listFor(column: ColumnDef, options: TemplateBuildInput["options"]): string[] {
  if (column.options) return [...column.options];
  const source = column.optionsFrom ? options?.[column.optionsFrom.name] : undefined;
  if (!source) return [];
  // A list that depends on another column becomes the union of all lists: Excel cannot filter it,
  // the server check (exact) remains the reference.
  return Array.isArray(source) ? [...source] : [...new Set(Object.values(source as Record<string, readonly string[]>).flat())];
}

type Validation = ExcelJS.DataValidation;

function validationFor(column: ColumnDef, period: TemplateBuildInput["period"], list: { formula: string } | null): Validation | null {
  const base = { allowBlank: !column.required, showErrorMessage: true, errorStyle: "stop" as const, errorTitle: column.label };
  const min = column.min ?? (column.kind === "percent" ? 0 : column.allowNegative ? undefined : 0);
  const max = column.max ?? (column.kind === "percent" ? 100 : undefined);
  switch (column.kind) {
    case "enum":
      return list ? { ...base, type: "list", formulae: [list.formula], error: "Choisissez une valeur de la liste." } : null;
    case "integer":
    case "amount":
      return { ...base, type: "whole", operator: max !== undefined ? "between" : "greaterThanOrEqual", formulae: max !== undefined ? [min ?? -1e12, max] : [min ?? -1e12], error: column.kind === "amount" ? "Saisissez un montant entier en FCFA." : "Saisissez un nombre entier." };
    case "decimal":
    case "percent":
      return { ...base, type: "decimal", operator: max !== undefined ? "between" : "greaterThanOrEqual", formulae: max !== undefined ? [min ?? -1e12, max] : [min ?? -1e12], error: "Saisissez un nombre." };
    case "date":
      return (column.dateInPeriod ?? true)
        ? { ...base, type: "date", operator: "between", formulae: [dayBound(period.start), dayBound(period.end)], error: `La date doit être comprise entre le ${formatDateFr(period.start)} et le ${formatDateFr(period.end)}.` }
        : null;
    default:
      return null;
  }
}

function addEntrySheet(wb: ExcelJS.Workbook, sheet: SheetDef, input: TemplateBuildInput, lists: ExcelJS.Worksheet, listColumn: { next: number }) {
  const ws = wb.addWorksheet(sheet.name, { views: [{ state: "frozen", ySplit: 1 }] });
  const lastRow = sheet.rows === "single" ? 2 : MAX_ENTRY_ROWS + 1;

  sheet.columns.forEach((column, index) => {
    const colNumber = index + 1;
    const col = ws.getColumn(colNumber);
    col.width = Math.min(48, Math.max(16, column.label.length + 4));
    col.numFmt = NUM_FORMAT[column.kind] ?? "@";
    col.protection = { locked: false };

    const header = ws.getCell(1, colNumber);
    header.value = column.label;
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    header.border = { bottom: { style: "medium", color: { argb: GOLD } } };
    header.alignment = { vertical: "middle", wrapText: true };
    header.protection = { locked: true };
    header.numFmt = "@";

    let list: { formula: string } | null = null;
    if (column.kind === "enum") {
      const values = listFor(column, input.options);
      if (values.length > 0) {
        const inline = values.join(",");
        if (inline.length <= INLINE_LIST_LIMIT && !values.some((v) => v.includes(",") || v.includes('"'))) {
          list = { formula: `"${inline}"` };
        } else {
          const letter = listColumn.next++;
          values.forEach((v, i) => (lists.getCell(i + 1, letter).value = v));
          const ref = lists.getColumn(letter).letter;
          list = { formula: `${LISTS_SHEET}!$${ref}$1:$${ref}$${values.length}` };
        }
      }
    }
    const validation = validationFor(column, input.period, list);
    const prefilled = input.prefill?.[sheet.name]?.[column.key];
    for (let r = 2; r <= lastRow; r++) {
      const cell = ws.getCell(r, colNumber);
      cell.protection = { locked: false };
      cell.numFmt = NUM_FORMAT[column.kind] ?? "@";
      if (validation) cell.dataValidation = validation;
      if (r === 2 && prefilled !== undefined) cell.value = prefilled;
    }
  });
  ws.getRow(1).height = 32;
  return ws;
}

function addInstructions(wb: ExcelJS.Workbook, input: TemplateBuildInput) {
  const ws = wb.addWorksheet("Instructions", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 44;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 70;

  const days = daysInPeriod(input.period.start, input.period.end);
  const lines: [string, string][] = [
    ["Modèle", input.template.label],
    ["Entité", input.entity.name],
    ["Période", `${formatDateFr(input.period.start)} au ${formatDateFr(input.period.end)} (${days} jours)`],
    ["À déposer avant le", formatDateFr(input.period.dueAt)],
  ];
  ws.getCell("A1").value = "Comment remplir ce fichier";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } };
  lines.forEach(([label, value], i) => {
    ws.getCell(3 + i, 1).value = label;
    ws.getCell(3 + i, 1).font = { bold: true };
    ws.getCell(3 + i, 2).value = value;
  });

  let row = 3 + lines.length + 1;
  const notes = [
    "Remplissez uniquement les feuilles de saisie, à partir de la ligne 2. Ne modifiez pas les en-têtes.",
    "La période est fixée par ce fichier : ne la saisissez pas.",
    "Les montants sont en FCFA, sans décimales. Les indicateurs (GOP, marges, ratios…) sont calculés par la plateforme : ne les saisissez pas.",
    "Une ligne par élément (livraison, chantier, produit…). Ne regroupez pas plusieurs dates ou plusieurs bons dans une cellule.",
    "Déposez le fichier au format .xlsx uniquement (pas .xls ni .xlsm).",
  ];
  for (const note of notes) ws.getCell(row++, 1).value = `• ${note}`;

  for (const sheet of input.template.sheets) {
    row += 1;
    ws.getCell(row, 1).value = `Feuille « ${sheet.name} » — ${sheet.label}${sheet.rows === "single" ? " (une seule ligne)" : ""}`;
    ws.getCell(row, 1).font = { bold: true, color: { argb: NAVY } };
    row += 1;
    ["Colonne", "Type", "Requis", "Règles"].forEach((h, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.border = { bottom: { style: "thin" } };
    });
    for (const column of sheet.columns) {
      row += 1;
      const rules: string[] = [];
      if (column.gt !== undefined) rules.push(`strictement supérieur à ${column.gt}`);
      if (column.min !== undefined) rules.push(`minimum ${column.min}`);
      if (column.max !== undefined) rules.push(`maximum ${column.max}`);
      if (column.uniqueInFile) rules.push("unique dans le fichier");
      if (column.kind === "date" && (column.dateInPeriod ?? true)) rules.push("dans la période");
      if (column.hint) rules.push(column.hint);
      ws.getCell(row, 1).value = column.label;
      ws.getCell(row, 2).value = KIND_LABEL[column.kind];
      ws.getCell(row, 3).value = column.required ? "oui" : column.requiredIf ? "selon" : "non";
      ws.getCell(row, 4).value = rules.join(" ; ");
      ws.getCell(row, 4).alignment = { wrapText: true, vertical: "top" };
    }
  }
}

/**
 * Fichier Excel à remplir, propre à une entité et à une période (avenant n°1, §5) : en-têtes figés
 * et protégés, listes déroulantes, bornes numériques, dates limitées à la période, feuille
 * `Instructions`, feuille masquée `_meta` signée. La protection est un garde-fou d'ergonomie, pas
 * une mesure de sécurité : le contrôle serveur reste la seule référence.
 */
export async function buildTemplateWorkbook(input: TemplateBuildInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MANGA PERFORMANCE";
  wb.created = input.generatedAt ?? new Date();

  // Created first so the entry sheets can reference it; hidden at the end.
  const lists = wb.addWorksheet(LISTS_SHEET);
  const listColumn = { next: 1 };

  const entrySheets = input.template.sheets.map((sheet) => addEntrySheet(wb, sheet, input, lists, listColumn));
  addInstructions(wb, input);

  const meta = wb.addWorksheet(META_SHEET);
  const token = signMeta({ templateId: input.template.id, version: input.template.version, entityId: input.entity.id, periodId: input.period.id }, input.secret);
  meta.getCell("A1").value = "templateId";
  meta.getCell("B1").value = input.template.id;
  meta.getCell("A2").value = "version";
  meta.getCell("B2").value = input.template.version;
  meta.getCell("A3").value = "entityId";
  meta.getCell("B3").value = input.entity.id;
  meta.getCell("A4").value = "periodId";
  meta.getCell("B4").value = input.period.id;
  meta.getCell("A5").value = "signature";
  meta.getCell("B5").value = token;

  lists.state = "veryHidden";
  meta.state = "veryHidden";
  // The file opens on the first entry sheet (the hidden lists sheet is index 0).
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 1, visibility: "visible" }];

  for (const ws of entrySheets) {
    await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, formatCells: true });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
