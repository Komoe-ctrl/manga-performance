"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, Hourglass } from "lucide-react";
import { useAsync } from "@/lib/hooks/use-async";
import { getCollectionOverview } from "@/lib/services/collection";
import { PERIOD_STATUS_LABELS, SECTOR_LABELS, type PeriodStatus, type Sector } from "@/lib/types/collection";
import { cn } from "@/lib/utils/cn";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

/** Couleur + symbole : le statut ne repose jamais sur la couleur seule. */
const STATUS_STYLE: Record<PeriodStatus, { cell: string; symbol: string }> = {
  A_VENIR: { cell: "bg-muted text-muted-foreground", symbol: "·" },
  ATTENDU: { cell: "bg-accent/25 text-accent-foreground", symbol: "…" },
  EN_RETARD: { cell: "bg-danger/15 text-danger", symbol: "!" },
  EN_CONTROLE: { cell: "bg-primary/10 text-primary", symbol: "⏳" },
  REJETE: { cell: "bg-danger text-white", symbol: "✕" },
  VALIDE: { cell: "bg-success/15 text-success", symbol: "✓" },
  ACCEPTE_AVEC_RESERVE: { cell: "bg-success/40 text-success", symbol: "✓*" },
};

const ALL = "all";

export function TrackingBoard() {
  const data = useAsync(getCollectionOverview);
  const [client, setClient] = useState(ALL);
  const [sector, setSector] = useState(ALL);

  const rows = useMemo(() => {
    if (data.status !== "success") return [];
    return data.data.rows.filter((r) => (client === ALL || r.client.id === client) && (sector === ALL || r.entity.sector === sector));
  }, [data, client, sector]);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Suivi indisponible." onRetry={data.reload} />;

  const { months, clients } = data.data;
  // Dernier mois terminé = dernière colonne qui n'est plus « à venir » pour au moins une ligne.
  const lastClosed = [...months].reverse().find((m) => rows.some((r) => r.periods.find((p) => p.id.endsWith(m.key))?.status !== "A_VENIR"));
  const closed = rows.map((r) => r.periods.find((p) => lastClosed && p.id.endsWith(lastClosed.key))).filter((p) => p && p.status !== "A_VENIR");
  const complete = closed.filter((p) => p!.status === "VALIDE" || p!.status === "ACCEPTE_AVEC_RESERVE").length;
  const late = rows.flatMap((r) => r.periods).filter((p) => p.status === "EN_RETARD").length;
  const rejected = rows.flatMap((r) => r.periods).filter((p) => p.status === "REJETE").length;
  const sectors = [...new Set(data.data.rows.map((r) => r.entity.sector))];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<CheckCircle2 className="h-5 w-5 text-success" aria-hidden />} label={`Complétude ${lastClosed?.label ?? ""}`} value={closed.length ? `${Math.round((complete / closed.length) * 100)} %` : "—"} hint={`${complete} dépôt(s) acceptés sur ${closed.length} attendus`} />
        <Stat icon={<Hourglass className="h-5 w-5 text-danger" aria-hidden />} label="Périodes en retard" value={String(late)} hint="Échéance dépassée, aucun dépôt" />
        <Stat icon={<FileWarning className="h-5 w-5 text-danger" aria-hidden />} label="Rejets en cours" value={String(rejected)} hint="En attente d'un nouveau dépôt" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Filter label="Client" value={client} onChange={setClient} options={clients.map((c) => [c.id, c.name])} />
        <Filter label="Secteur" value={sector} onChange={setSector} options={sectors.map((s) => [s, SECTOR_LABELS[s as Sector]])} />
        <ul className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Légende des statuts">
          {(Object.keys(STATUS_STYLE) as PeriodStatus[]).map((s) => (
            <li key={s} className="flex items-center gap-1">
              <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold", STATUS_STYLE[s].cell)} aria-hidden>{STATUS_STYLE[s].symbol}</span>
              {PERIOD_STATUS_LABELS[s]}
            </li>
          ))}
        </ul>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="Aucun plan de collecte pour ces filtres." />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-border bg-background">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Suivi des dépôts par entité et par mois</caption>
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Entité · modèle</th>
                {months.map((m) => (
                  <th key={m.key} scope="col" className="px-2 py-2 text-center font-semibold capitalize">{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.plan.id} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <p className="font-semibold text-primary">{r.entity.name}</p>
                    <p className="text-xs text-muted-foreground">{r.template.label} · {r.client.name}</p>
                  </th>
                  {months.map((m) => {
                    const period = r.periods.find((p) => p.id.endsWith(m.key));
                    const status = period?.status ?? "A_VENIR";
                    return (
                      <td key={m.key} className="px-1.5 py-1.5 text-center">
                        <span
                          title={`${PERIOD_STATUS_LABELS[status]}${period?.submissions.length ? ` — version ${period.submissions[period.submissions.length - 1].version}` : ""}`}
                          className={cn("inline-flex h-8 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-bold", STATUS_STYLE[status].cell)}
                        >
                          <span aria-hidden>{STATUS_STYLE[status].symbol}</span>
                          <span className="sr-only">{PERIOD_STATUS_LABELS[status]}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Données de démonstration fictives. Le détail d&apos;une période, les relances et les exports arrivent dans la suite de l&apos;étape A1.
      </p>
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-sm">
        <option value={ALL}>Tous</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
