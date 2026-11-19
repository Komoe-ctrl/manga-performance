import type { RawCell } from "./types";

/** Texte d'une cellule vide ? (null, undefined, chaîne blanche) */
export function isBlank(cell: RawCell): boolean {
  return cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
}

const EXCEL_ERRORS = /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)$/i;

/** `#DIV/0!` et consorts : une formule du fichier a échoué. */
export function isExcelError(cell: RawCell): boolean {
  return typeof cell === "string" && EXCEL_ERRORS.test(cell.trim());
}

/** Affiche une valeur brute dans un message (« 125 », « abc », « 03/10/2026 »). */
export function displayRaw(cell: RawCell): string | null {
  if (isBlank(cell)) return null;
  if (cell instanceof Date) return formatDateFr(cell);
  return String(cell).trim();
}

/** Nombre au format français (1 250,75). */
export function formatNumberFr(n: number): string {
  const [int, dec] = String(n).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec ? `${grouped},${dec}` : grouped;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** JJ/MM/AAAA, en UTC (les dates du moteur sont des jours calendaires, sans fuseau). */
export function formatDateFr(d: Date): string {
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Lit un nombre. Accepte les nombres, et les textes « 1 250,75 » / « 1250.75 » (espaces, espaces
 * insécables, virgule décimale). Refuse tout le reste : jamais de lecture approximative.
 */
export function parseNumber(cell: RawCell): Parsed<number> {
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? { ok: true, value: cell } : { ok: false, reason: "n'est pas un nombre valide" };
  }
  if (typeof cell === "string") {
    const text = cell.trim().replace(/[\s  ]/g, "").replace(/(FCFA|XOF|CFA|%)$/i, "");
    if (/^[+-]?\d+([.,]\d+)?$/.test(text)) {
      const value = Number(text.replace(",", "."));
      if (Number.isFinite(value)) return { ok: true, value };
    }
    return { ok: false, reason: "n'est pas un nombre" };
  }
  return { ok: false, reason: "n'est pas un nombre" };
}

/** Lit une date : objet `Date`, texte JJ/MM/AAAA (ou JJ-MM-AAAA) ou AAAA-MM-JJ. Jours calendaires en UTC. */
export function parseDate(cell: RawCell): Parsed<Date> {
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return { ok: false, reason: "n'est pas une date valide" };
    return { ok: true, value: new Date(Date.UTC(cell.getUTCFullYear(), cell.getUTCMonth(), cell.getUTCDate())) };
  }
  if (typeof cell === "string") {
    const text = cell.trim();
    const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const [d, m, y] = fr ? [Number(fr[1]), Number(fr[2]), Number(fr[3])] : iso ? [Number(iso[3]), Number(iso[2]), Number(iso[1])] : [0, 0, 0];
    if (d && m && y) {
      const date = new Date(Date.UTC(y, m - 1, d));
      // Rejects 31/02/2026: the constructor would roll over to March.
      if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) return { ok: true, value: date };
    }
  }
  return { ok: false, reason: "n'est pas une date au format JJ/MM/AAAA" };
}

/** Nombre de jours d'une période (bornes incluses). */
export function daysInPeriod(start: Date, end: Date): number {
  const ms = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return Math.round(ms / 86_400_000) + 1;
}
