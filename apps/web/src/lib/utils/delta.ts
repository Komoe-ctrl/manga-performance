/**
 * Variation d'un indicateur entre deux périodes, affichée de la même façon partout : en **points** pour un indicateur
 * exprimé en pourcentage (GOP Margin, taux d'occupation…), en **pourcentage** pour un montant (RevPAR, GOP…).
 */
export type DeltaKind = "ratio" | "amount";

export interface Delta {
  /** « +0,9 pt », « −3,2 % » (vrai signe moins). */
  text: string;
  direction: "up" | "down" | "flat";
  /** Valeur numérique : des points (`ratio`) ou des pourcents (`amount`). */
  value: number;
}

const format = (value: number, digits = 1) => Math.abs(value).toFixed(digits).replace(".", ",");

export function formatDelta(kind: DeltaKind, now: number | null | undefined, before: number | null | undefined): Delta | null {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) return null;
  if (kind === "amount" && before === 0) return null;
  const value = kind === "ratio" ? now - before : ((now - before) * 100) / Math.abs(before);
  const rounded = Number(value.toFixed(1));
  const unit = kind === "ratio" ? "pt" : "%";
  if (rounded === 0) return { text: `0,0 ${unit}`, direction: "flat", value: 0 };
  const sign = rounded > 0 ? "+" : "−";
  return { text: `${sign}${format(value)} ${unit}`, direction: rounded > 0 ? "up" : "down", value };
}
