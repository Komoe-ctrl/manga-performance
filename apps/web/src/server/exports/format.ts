import type { Cell } from "./types";

const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `07/11/2026 14:05`, always in Africa/Abidjan whatever the server's zone. */
export function formatDateTime(value: Date): string {
  return DATE_TIME.format(value).replace(",", "");
}

/** `1 234 567`, with a plain space: the PDF's built-in font has no narrow no-break space. */
export function formatInt(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatCell(value: Cell, type: "text" | "int" | "money" | "date" = "text"): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === "number") return type === "money" ? `${formatInt(value)} FCFA` : formatInt(value);
  return value;
}

/** `prospects-2026-11-07` */
export function datedName(slug: string, now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Abidjan" }).format(now);
  return `${slug}-${day}`;
}
