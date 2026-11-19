import ExcelJS from "exceljs";
import type { ColumnDef, NormalizedRow, TemplateDef } from "./types";

/**
 * Export consolidé (avenant n°1, §8) : un seul fichier Excel pour un modèle et une plage de périodes,
 * à brancher sur Power BI ou Excel à la place d'un dossier de fichiers hétérogènes.
 */

/**
 * Anti-injection CSV/Excel : un texte qui commence par `=`, `+`, `-` ou `@` (ou par une tabulation ou un
 * retour chariot, que certains tableurs ignorent avant de lire une formule) est préfixé d'une apostrophe.
 * Les nombres et les dates ne sont jamais des textes : ils ne passent pas ici.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export const DEPOSIT_STATUS_LABELS = { VALIDE: "Validé", ACCEPTE_AVEC_RESERVE: "Accepté avec réserve" } as const;

export const PERIOD_STATUS_LABELS: Record<string, string> = {
  A_VENIR: "À venir",
  ATTENDU: "Attendu",
  EN_RETARD: "En retard",
  EN_CONTROLE: "En contrôle",
  REJETE: "Rejeté",
  VALIDE: "Validé",
  ACCEPTE_AVEC_RESERVE: "Accepté avec réserve",
};

export interface ExportDeposit {
  client: string;
  entity: string;
  periodStart: Date;
  periodEnd: Date;
  version: number;
  status: keyof typeof DEPOSIT_STATUS_LABELS;
  /** Lignes normalisées par feuille du modèle. */
  rows: Record<string, readonly NormalizedRow[]>;
}

export interface MissingEntry {
  client: string;
  entity: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  dueAt: Date;
}

const NAVY = "FF1A2B4A";
const GOLD = "FFF5B700";
const PREFIX = ["Client", "Entité", "Période", "Version du dépôt", "Statut du dépôt"] as const;

/** `2026-10` pour une période mensuelle, la date de début (`2026-11-16`) pour une période plus courte. */
export function periodKey(start: Date, end: Date): string {
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const iso = start.toISOString().slice(0, 10);
  return days > 8 ? iso.slice(0, 7) : iso;
}

const NUM_FORMAT: Partial<Record<ColumnDef["kind"], string>> = {
  integer: "0",
  decimal: "#,##0.00##",
  amount: "#,##0",
  percent: "0.0",
  date: "dd/mm/yyyy",
};

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.border = { bottom: { style: "medium", color: { argb: GOLD } } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function cellValue(column: ColumnDef, value: NormalizedRow[string] | undefined): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (column.kind === "date" && typeof value === "string") {
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? neutralizeFormula(value) : d;
  }
  return typeof value === "string" ? neutralizeFormula(value) : value;
}

/**
 * Classeur consolidé : une feuille par feuille du modèle (lignes des dépôts `VALIDE` et
 * `ACCEPTE_AVEC_RESERVE`, préfixées par Client, Entité, Période et Version du dépôt), plus une feuille
 * `Suivi` qui liste les entités dont la période n'est pas (encore) acceptée.
 */
export async function buildConsolidatedWorkbook(input: {
  template: TemplateDef;
  deposits: readonly ExportDeposit[];
  missing: readonly MissingEntry[];
  generatedAt: Date;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MANGA PERFORMANCE";
  wb.created = input.generatedAt;

  const ordered = [...input.deposits].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime() || a.client.localeCompare(b.client) || a.entity.localeCompare(b.entity));

  for (const sheet of input.template.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    const headers = [...PREFIX, ...sheet.columns.map((c) => c.label)];
    ws.addRow(headers);
    styleHeader(ws.getRow(1));
    headers.forEach((h, i) => (ws.getColumn(i + 1).width = Math.min(44, Math.max(14, h.length + 4))));
    sheet.columns.forEach((c, i) => {
      const fmt = NUM_FORMAT[c.kind];
      if (fmt) ws.getColumn(PREFIX.length + i + 1).numFmt = fmt;
    });

    for (const deposit of ordered) {
      for (const row of deposit.rows[sheet.name] ?? []) {
        ws.addRow([
          neutralizeFormula(deposit.client),
          neutralizeFormula(deposit.entity),
          periodKey(deposit.periodStart, deposit.periodEnd),
          deposit.version,
          DEPOSIT_STATUS_LABELS[deposit.status],
          ...sheet.columns.map((c) => cellValue(c, row[c.key])),
        ]);
      }
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  }

  const follow = wb.addWorksheet("Suivi", { views: [{ state: "frozen", ySplit: 1 }] });
  follow.addRow(["Client", "Entité", "Période", "Statut", "Échéance"]);
  styleHeader(follow.getRow(1));
  [24, 28, 14, 22, 14].forEach((w, i) => (follow.getColumn(i + 1).width = w));
  follow.getColumn(5).numFmt = "dd/mm/yyyy";
  const missing = [...input.missing].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime() || a.client.localeCompare(b.client) || a.entity.localeCompare(b.entity));
  for (const m of missing) {
    follow.addRow([neutralizeFormula(m.client), neutralizeFormula(m.entity), periodKey(m.periodStart, m.periodEnd), PERIOD_STATUS_LABELS[m.status] ?? m.status, m.dueAt]);
  }
  follow.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
