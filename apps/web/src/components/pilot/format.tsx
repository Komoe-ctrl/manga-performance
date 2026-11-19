import type { CoverageStatus } from "@manga/core/kpi/consumables";
import { cn } from "@/lib/utils/cn";

/** Nombre au format français, `—` quand le calcul est impossible (division par zéro, donnée manquante). */
export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const fcfa = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${num(value)} FCFA`);
export const pct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? "—" : `${num(value, digits)} %`);
export const signed = (value: number | null | undefined, digits = 0) => (value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${num(value, digits)}`);

/** Couleur + symbole + libellé : le statut ne repose jamais sur la couleur seule. */
export const COVERAGE_STYLE: Record<CoverageStatus, { label: string; symbol: string; tone: string }> = {
  CONFORME: { label: "Conforme", symbol: "✓", tone: "bg-success/15 text-success" },
  SOUS: { label: "Sous-distribution", symbol: "▼", tone: "bg-warning/15 text-warning" },
  SOUS_FORTE: { label: "Sous-distribution forte", symbol: "▼▼", tone: "bg-danger/15 text-danger" },
  SUR: { label: "Sur-distribution", symbol: "▲", tone: "bg-warning/15 text-warning" },
  SUR_FORTE: { label: "Sur-distribution forte", symbol: "▲▲", tone: "bg-danger/15 text-danger" },
  CPRO_MANQUANT: { label: "CPRO manquant", symbol: "⚠", tone: "bg-accent/25 text-accent-foreground" },
  CONVERSION_MANQUANTE: { label: "Conversion manquante", symbol: "⚠", tone: "bg-accent/25 text-accent-foreground" },
  NA: { label: "N/A", symbol: "–", tone: "bg-muted text-muted-foreground" },
};

export function CoverageBadge({ status }: { status: CoverageStatus }) {
  const s = COVERAGE_STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", s.tone)}>
      <span aria-hidden>{s.symbol}</span>
      {s.label}
    </span>
  );
}

/** Palette de la marque, lisible à l'impression. */
export const CHART_COLORS = ["#1A2B4A", "#3B5B8F", "#C98F00", "#F5B700", "#7A93BB", "#94A3B8"];
