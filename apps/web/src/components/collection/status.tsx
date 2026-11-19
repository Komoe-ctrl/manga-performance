import { PERIOD_STATUS_LABELS, type ControlIssue, type PeriodStatus, type SubmissionReport } from "@/lib/types/collection";
import { cn } from "@/lib/utils/cn";

/** Couleur + symbole : le statut ne repose jamais sur la couleur seule. */
export const STATUS_STYLE: Record<PeriodStatus, { cell: string; symbol: string }> = {
  A_VENIR: { cell: "bg-muted text-muted-foreground", symbol: "·" },
  ATTENDU: { cell: "bg-accent/25 text-accent-foreground", symbol: "…" },
  EN_RETARD: { cell: "bg-danger/15 text-danger", symbol: "!" },
  EN_CONTROLE: { cell: "bg-primary/10 text-primary", symbol: "⏳" },
  REJETE: { cell: "bg-danger text-white", symbol: "✕" },
  VALIDE: { cell: "bg-success/15 text-success", symbol: "✓" },
  ACCEPTE_AVEC_RESERVE: { cell: "bg-success/40 text-success", symbol: "✓*" },
};

export function StatusPill({ status }: { status: PeriodStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[status].cell)}>
      <span aria-hidden>{STATUS_STYLE[status].symbol}</span>
      {PERIOD_STATUS_LABELS[status]}
    </span>
  );
}

/** Rapport de contrôle lisible : un tableau ligne / colonne / valeur / message (avenant §10). */
export function ReportView({ report }: { report: SubmissionReport | null }) {
  if (!report) return <p className="text-sm text-muted-foreground">Contrôle en cours…</p>;
  if (report.errors.length === 0 && report.warnings.length === 0) return <p className="text-sm text-success">Aucune erreur, aucun avertissement.</p>;
  return (
    <div className="space-y-3">
      {report.errors.length > 0 && <IssueTable title="Erreurs (le dépôt est rejeté)" tone="danger" issues={report.errors} />}
      {report.warnings.length > 0 && <IssueTable title="Avertissements (ne bloquent pas)" tone="warning" issues={report.warnings} />}
    </div>
  );
}

function IssueTable({ title, tone, issues }: { title: string; tone: "danger" | "warning"; issues: ControlIssue[] }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[420px] text-sm">
        <caption className={cn("px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide", tone === "danger" ? "text-danger" : "text-accent-foreground")}>
          {title} ({issues.length})
        </caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-1.5">Ligne</th>
            <th scope="col" className="px-3 py-1.5">Colonne</th>
            <th scope="col" className="px-3 py-1.5">Valeur</th>
            <th scope="col" className="px-3 py-1.5">Message</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i, n) => (
            <tr key={n} className="border-t border-border align-top">
              <td className="px-3 py-1.5">{i.row ?? "—"}</td>
              <td className="px-3 py-1.5">{i.column ?? "—"}</td>
              <td className="px-3 py-1.5">{i.value ?? "—"}</td>
              <td className="px-3 py-1.5">{i.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
