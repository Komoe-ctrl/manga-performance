import { daysInPeriod, displayRaw, formatDateFr, formatNumberFr, isBlank, isExcelError, parseDate, parseNumber, toIsoDate } from "./cells";
import type {
  ColumnDef,
  CrossRule,
  InputRow,
  Issue,
  NormalizedRow,
  NormalizedValue,
  PeriodContext,
  RawCell,
  SheetDef,
  SheetInput,
  TemplateDef,
  ValidationResult,
} from "./types";

/** Au-delà, le rapport est tronqué : un fichier entièrement faux ne doit pas produire 50 000 messages. */
export const MAX_ISSUES = 500;
const MAX_TEXT_LENGTH = 200;
const MAX_LISTED_OPTIONS = 8;

class Reporter {
  readonly errors: Issue[] = [];
  readonly warnings: Issue[] = [];
  truncated = false;

  constructor(private readonly max: number) {}

  add(issue: Issue) {
    if (this.errors.length + this.warnings.length >= this.max) {
      this.truncated = true;
      // An error beyond the cap must still reject the file.
      if (issue.severity === "error" && this.errors.length === 0) this.errors.push(issue);
      return;
    }
    (issue.severity === "error" ? this.errors : this.warnings).push(issue);
  }
}

function issue(
  severity: Issue["severity"],
  sheet: SheetDef,
  row: number | null,
  column: ColumnDef | null,
  code: string,
  message: string,
  value: RawCell = null,
): Issue {
  const where = row === null ? "" : `Ligne ${row}${column ? `, ${column.label}` : ""} : `;
  return { severity, sheet: sheet.name, row, column: column?.key ?? null, columnLabel: column?.label ?? null, value: displayRaw(value), code, message: `${where}${message}` };
}

function listOptions(options: readonly string[]): string {
  const shown = options.slice(0, MAX_LISTED_OPTIONS).join(", ");
  return options.length > MAX_LISTED_OPTIONS ? `${shown}…` : shown;
}

/** Options d'une colonne `enum`, ou `null` si la liste n'est pas configurée. */
function optionsFor(column: ColumnDef, ctx: PeriodContext, row: NormalizedRow): readonly string[] | null | undefined {
  if (column.options) return column.options;
  if (!column.optionsFrom) return null;
  const source = ctx.options?.[column.optionsFrom.name];
  if (source === undefined) return null;
  if (Array.isArray(source)) return source as readonly string[];
  const by = column.optionsFrom.by;
  if (!by) return null;
  const key = row[by];
  // The column this list depends on is itself invalid: no second error on top of the first.
  if (typeof key !== "string") return undefined;
  return (source as Record<string, readonly string[]>)[key] ?? [];
}

interface Cell {
  value: NormalizedValue;
  /** Vrai quand la cellule est vide ou invalide (les règles croisées l'ignorent). */
  absent: boolean;
}

function checkCell(sheet: SheetDef, column: ColumnDef, raw: RawCell, rowNumber: number, row: NormalizedRow, ctx: PeriodContext, report: Reporter): Cell {
  const err = (code: string, message: string) => report.add(issue("error", sheet, rowNumber, column, code, message, raw));

  if (isBlank(raw)) {
    if (column.required) err("REQUIRED", "valeur requise, la cellule est vide.");
    return { value: null, absent: true };
  }
  if (isExcelError(raw)) {
    err("EXCEL_ERROR", `la cellule contient une erreur de formule (${String(raw).trim()}) : corrigez-la avant de déposer le fichier.`);
    return { value: null, absent: true };
  }

  if (column.kind === "text") {
    const text = raw instanceof Date ? formatDateFr(raw) : String(raw).trim();
    if (text.length > MAX_TEXT_LENGTH) {
      err("TOO_LONG", `texte trop long (${text.length} caractères, maximum ${MAX_TEXT_LENGTH}).`);
      return { value: null, absent: true };
    }
    return { value: text, absent: false };
  }

  if (column.kind === "enum") {
    const text = String(raw).trim();
    const options = optionsFor(column, ctx, row);
    if (options === undefined) return { value: null, absent: true };
    if (options === null) {
      err("OPTIONS_UNAVAILABLE", `la liste de valeurs autorisées n'est pas configurée pour ce client (${column.optionsFrom?.name ?? column.key}).`);
      return { value: null, absent: true };
    }
    const found = options.find((o) => o.trim().toLowerCase() === text.toLowerCase());
    if (!found) {
      err("NOT_IN_LIST", options.length === 0 ? `« ${text} » n'est pas autorisé ici.` : `« ${text} » n'est pas dans la liste autorisée (${listOptions(options)}).`);
      return { value: null, absent: true };
    }
    return { value: found, absent: false };
  }

  if (column.kind === "date") {
    const parsed = parseDate(raw);
    if (!parsed.ok) {
      err("INVALID_DATE", `${displayRaw(raw)} ${parsed.reason}.`);
      return { value: null, absent: true };
    }
    const d = parsed.value;
    if ((column.dateInPeriod ?? true) && (d < ctx.periodStart || d > ctx.periodEnd)) {
      err("DATE_OUT_OF_PERIOD", `${formatDateFr(d)} est hors de la période (${formatDateFr(ctx.periodStart)} au ${formatDateFr(ctx.periodEnd)}).`);
      return { value: null, absent: true };
    }
    return { value: toIsoDate(d), absent: false };
  }

  // Numeric kinds.
  const parsed = parseNumber(raw);
  if (!parsed.ok) {
    err("NOT_A_NUMBER", `« ${displayRaw(raw)} » ${parsed.reason}.`);
    return { value: null, absent: true };
  }
  let n = parsed.value;
  const shown = formatNumberFr(n);

  if ((column.kind === "integer" || column.kind === "amount") && !Number.isInteger(n)) {
    err("NOT_AN_INTEGER", column.kind === "amount" ? `${shown} n'est pas un montant entier en FCFA (pas de décimales).` : `${shown} doit être un nombre entier.`);
    return { value: null, absent: true };
  }
  const min = column.min ?? (column.kind === "percent" ? 0 : column.allowNegative ? undefined : 0);
  const max = column.max ?? (column.kind === "percent" ? 100 : undefined);
  if (column.gt !== undefined && n <= column.gt) {
    err("TOO_LOW", `${shown} doit être strictement supérieur à ${formatNumberFr(column.gt)}.`);
    return { value: null, absent: true };
  }
  if (min !== undefined && n < min) {
    err("BELOW_MIN", min === 0 && !column.allowNegative ? `${shown} est négatif : la valeur doit être positive ou nulle.` : `${shown} est inférieur au minimum (${formatNumberFr(min)}).`);
    return { value: null, absent: true };
  }
  if (max !== undefined && n > max) {
    err("ABOVE_MAX", `${shown} est supérieur au maximum (${formatNumberFr(max)}).`);
    return { value: null, absent: true };
  }
  if (column.kind === "percent") {
    const rounded = Math.round(n * 10) / 10;
    if (rounded !== n) {
      report.add(issue("warning", sheet, rowNumber, column, "ROUNDED", `${shown} a été arrondi à ${formatNumberFr(rounded)} (une décimale).`, raw));
      n = rounded;
    }
  }
  if (column.kind === "decimal") n = Math.round(n * 10_000) / 10_000;
  return { value: n, absent: false };
}

const VIOLATION: Record<CrossRule["op"], string> = {
  lte: "est supérieur",
  lt: "n'est pas inférieur",
  gte: "est inférieur",
  gt: "n'est pas supérieur",
  eq: "ne correspond pas",
};

function holds(op: CrossRule["op"], a: number, b: number): boolean {
  switch (op) {
    case "lte": return a <= b;
    case "lt": return a < b;
    case "gte": return a >= b;
    case "gt": return a > b;
    case "eq": return a === b;
  }
}

function checkCrossRules(sheet: SheetDef, column: ColumnDef, rowNumber: number, cells: Record<string, Cell>, ctx: PeriodContext, report: Reporter) {
  const mine = cells[column.key];
  if (!mine || mine.absent || typeof mine.value !== "number") return;
  for (const rule of column.crossRules ?? []) {
    const keys = typeof rule.other === "string" ? [rule.other] : [...rule.other];
    const others = keys.map((k) => cells[k]);
    if (others.some((c) => !c || c.absent || typeof c.value !== "number")) continue;
    let reference = others.reduce((sum, c) => sum + (c!.value as number), 0);
    if (rule.times === "days") reference *= daysInPeriod(ctx.periodStart, ctx.periodEnd);
    if (holds(rule.op, mine.value, reference)) continue;
    const labels = keys.map((k) => sheet.columns.find((c) => c.key === k)?.label ?? k).join(" + ");
    const against = rule.against ?? `à « ${labels} »`;
    report.add(
      issue(rule.severity ?? "error", sheet, rowNumber, column, "CROSS_RULE", `${formatNumberFr(mine.value)} ${VIOLATION[rule.op]} ${against} (${formatNumberFr(reference)}).`, mine.value),
    );
  }
}

const norm = (value: NormalizedValue) => String(value).trim().toLowerCase();

function checkSheet(sheet: SheetDef, input: SheetInput | undefined, ctx: PeriodContext, report: Reporter): { rows: NormalizedRow[]; rowNumbers: number[] } {
  if (!input) {
    report.add(issue("error", sheet, null, null, "SHEET_MISSING", `La feuille « ${sheet.name} » est absente du fichier.`));
    return { rows: [], rowNumbers: [] };
  }
  const keys = sheet.columns.map((c) => c.key);
  const data: InputRow[] = input.filter((r) => keys.some((k) => !isBlank(r.cells[k])));
  if (data.length === 0) {
    report.add(issue("error", sheet, null, null, "EMPTY", `La feuille « ${sheet.name} » ne contient aucune ligne de données.`));
    return { rows: [], rowNumbers: [] };
  }
  if (sheet.rows === "single" && data.length > 1) {
    report.add(issue("error", sheet, data[1]!.rowNumber, null, "TOO_MANY_ROWS", `La feuille « ${sheet.name} » n'accepte qu'une seule ligne de données (${data.length} trouvées).`));
  }

  const rows: NormalizedRow[] = [];
  const rowNumbers: number[] = [];
  const seen = new Map<string, number>(); // `${columnKey}|${group}|${value}` → first row

  for (const input of data) {
    const row: NormalizedRow = {};
    const cells: Record<string, Cell> = {};
    for (const column of sheet.columns) {
      const raw = input.cells[column.key];
      const cell = checkCell(sheet, column, raw, input.rowNumber, row, ctx, report);
      cells[column.key] = cell;
      row[column.key] = cell.value;
    }
    for (const column of sheet.columns) {
      const cell = cells[column.key]!;
      if (column.requiredIf && cell.absent && isBlank(input.cells[column.key]) && !isBlank(input.cells[column.requiredIf])) {
        const other = sheet.columns.find((c) => c.key === column.requiredIf);
        report.add(issue("error", sheet, input.rowNumber, column, "REQUIRED", `valeur requise lorsque « ${other?.label ?? column.requiredIf} » est renseigné.`));
      }
      if (cell.absent || cell.value === null) continue;
      if (column.uniqueInFile || column.uniqueWithin) {
        const group = column.uniqueWithin ? norm(row[column.uniqueWithin] ?? "") : "";
        const id = `${column.key}|${group}|${norm(cell.value)}`;
        const first = seen.get(id);
        if (first !== undefined) {
          const severity = column.duplicate ?? "error";
          const where = column.uniqueWithin ? " pour ce produit" : "";
          report.add(issue(severity, sheet, input.rowNumber, column, "DUPLICATE", `« ${cell.value} » apparaît déjà ligne ${first}${where}.`, cell.value as RawCell));
        } else seen.set(id, input.rowNumber);
      }
      checkCrossRules(sheet, column, input.rowNumber, cells, ctx, report);
    }
    rows.push(row);
    rowNumbers.push(input.rowNumber);
  }
  return { rows, rowNumbers };
}

/**
 * Contrôle un dépôt par rapport à la définition de son modèle (avenant n°1, §4 et §4.8).
 * Le dépôt est validé si **toutes** les feuilles le sont. Les erreurs rejettent ; les avertissements
 * (doublons de bon, incohérences avec le mois précédent…) n'empêchent rien.
 *
 * La lecture du fichier (format .xlsx, taille, en-têtes) est faite en amont : ce moteur reçoit des
 * cellules déjà lues, indexées par la clé de colonne.
 */
export function validateSubmission(template: TemplateDef, input: Record<string, SheetInput | undefined>, ctx: PeriodContext, options: { maxIssues?: number } = {}): ValidationResult {
  const report = new Reporter(options.maxIssues ?? MAX_ISSUES);
  const rows: Record<string, NormalizedRow[]> = {};
  const rowNumbers: Record<string, number[]> = {};

  for (const sheet of template.sheets) {
    const checked = checkSheet(sheet, input[sheet.name], ctx, report);
    rows[sheet.name] = checked.rows;
    rowNumbers[sheet.name] = checked.rowNumbers;
  }

  if (report.errors.length === 0) {
    for (const check of template.coherence ?? []) {
      for (const w of check(rows, ctx, rowNumbers)) report.add(w);
    }
  }

  const ok = report.errors.length === 0;
  return {
    ok,
    errors: report.errors,
    warnings: report.warnings,
    truncated: report.truncated,
    rows: ok ? rows : Object.fromEntries(template.sheets.map((s) => [s.name, []])),
  };
}

const headerKey = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** En-têtes attendus d'une feuille : ceux du modèle, dans l'ordre. */
export const expectedHeaders = (sheet: SheetDef): string[] => sheet.columns.map((c) => c.label);

/**
 * Vérifie que les en-têtes lus (ligne 1) sont ceux du modèle (avenant n°1, §4.8). Un en-tête manquant
 * rejette ; une colonne en plus est seulement signalée. Retourne la correspondance en-tête → clé.
 */
export function matchHeaders(sheet: SheetDef, found: readonly string[]): { map: Record<number, string>; issues: Issue[] } {
  const issues: Issue[] = [];
  const map: Record<number, string> = {};
  const byHeader = new Map(sheet.columns.map((c) => [headerKey(c.label), c]));
  const used = new Set<string>();
  found.forEach((header, index) => {
    if (isBlank(header)) return;
    const column = byHeader.get(headerKey(header));
    if (column && !used.has(column.key)) {
      map[index] = column.key;
      used.add(column.key);
    } else if (!column) {
      issues.push(issue("warning", sheet, 1, null, "UNKNOWN_COLUMN", `colonne « ${header.trim()} » inconnue : elle est ignorée.`));
    }
  });
  for (const column of sheet.columns) {
    if (!used.has(column.key)) {
      issues.push(issue("error", sheet, 1, null, "HEADER_MISSING", `en-tête « ${column.label} » introuvable : utilisez le modèle fourni par la plateforme.`));
    }
  }
  return { map, issues };
}
