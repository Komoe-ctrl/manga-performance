"use client";

import { useMemo, useState } from "react";
import { BellRing, CheckCircle2, Download, FileWarning, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { exportUrl, getCollectionOverview, monthCompleteness, monthKey, remindPeriods } from "@/lib/services/collection";
import { USE_DB } from "@/lib/services/data-source";
import { PERIOD_STATUS_LABELS, SECTOR_LABELS, type PeriodStatus, type Sector } from "@/lib/types/collection";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";
import { PeriodPanel } from "./period-panel";
import { STATUS_STYLE } from "./status";

const ALL = "all";

export function TrackingBoard() {
  const [version, setVersion] = useState(0);
  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);
  const data = useAsync(getCollectionOverview, [version]);
  const [client, setClient] = useState(ALL);
  const [sector, setSector] = useState(ALL);

  const rows = useMemo(() => {
    if (data.status !== "success") return [];
    return data.data.rows.filter((r) => (client === ALL || r.client.id === client) && (sector === ALL || r.entity.sector === sector));
  }, [data, client, sector]);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Suivi indisponible." onRetry={data.reload} />;

  const { months, clients } = data.data;
  const completeness = monthCompleteness(rows, months);
  const late = rows.flatMap((r) => r.periods).filter((p) => p.status === "EN_RETARD").length;
  const rejected = rows.flatMap((r) => r.periods).filter((p) => p.status === "REJETE").length;
  const sectors = [...new Set(data.data.rows.map((r) => r.entity.sector))];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<CheckCircle2 className="h-5 w-5 text-success" aria-hidden />} label={`Complétude ${completeness?.label ?? ""}`} value={completeness?.expected ? `${Math.round((completeness.complete / completeness.expected) * 100)} %` : "—"} hint={`${completeness?.complete ?? 0} dépôt(s) acceptés sur ${completeness?.expected ?? 0} attendus`} />
        <Stat icon={<Hourglass className="h-5 w-5 text-danger" aria-hidden />} label="Périodes en retard" value={String(late)} hint="Échéance dépassée, aucun dépôt" />
        <Stat icon={<FileWarning className="h-5 w-5 text-danger" aria-hidden />} label="Rejets en cours" value={String(rejected)} hint="En attente d'un nouveau dépôt" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Filter label="Client" value={client} onChange={setClient} options={clients.map((c) => [c.id, c.name])} />
        <Filter label="Secteur" value={sector} onChange={setSector} options={sectors.map((s) => [s, SECTOR_LABELS[s as Sector]])} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={reminding}
            disabled={late === 0}
            title={late === 0 ? "Aucune période en retard" : undefined}
            onClick={async () => {
              setReminding(true);
              try {
                const ids = rows.flatMap((r) => r.periods).filter((p) => p.status === "EN_RETARD").map((p) => p.id);
                const sent = await remindPeriods(ids);
                toast.success(`${sent} relance(s) envoyée(s)${sent < ids.length ? ` — ${ids.length - sent} ignorée(s) (plafond atteint)` : ""}`);
                setVersion((v) => v + 1);
              } finally {
                setReminding(false);
              }
            }}
          >
            <BellRing className="h-4 w-4" aria-hidden /> Relancer les retards ({late})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!USE_DB) return toast.info("Export du suivi disponible avec la base de données (DATA_SOURCE=db)");
              const first = rows[0];
              const range = months.length ? { from: months[0]!.key, to: months.at(-1)!.key } : null;
              if (!first || !range) return toast.info("Rien à exporter.");
              window.location.assign(exportUrl({ templateId: first.template.id, ...range, ...(client !== ALL ? { clientId: client } : {}), ...(sector !== ALL ? { sector } : {}) }));
            }}
          >
            <Download className="h-4 w-4" aria-hidden /> Exporter le suivi
          </Button>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Légende des statuts">
          {(Object.keys(STATUS_STYLE) as PeriodStatus[]).map((s) => (
            <li key={s} className="flex items-center gap-1">
              <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold", STATUS_STYLE[s].cell)} aria-hidden>{STATUS_STYLE[s].symbol}</span>
              {PERIOD_STATUS_LABELS[s]}
            </li>
          ))}
        </ul>

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
                    const period = r.periods.find((p) => monthKey(p) === m.key);
                    const status = period?.status ?? "A_VENIR";
                    return (
                      <td key={m.key} className="px-1.5 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => setOpenPeriod(period?.id ?? null)}
                          disabled={status === "A_VENIR"}
                          title={`${PERIOD_STATUS_LABELS[status]}${period?.submissions.length ? ` — version ${period.submissions[period.submissions.length - 1].version}` : ""}`}
                          className={cn("inline-flex h-8 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-bold transition-transform enabled:hover:scale-110 enabled:focus-visible:ring-2 enabled:focus-visible:ring-accent", STATUS_STYLE[status].cell)}
                        >
                          <span aria-hidden>{STATUS_STYLE[status].symbol}</span>
                          <span className="sr-only">{`${r.entity.name}, ${m.label} : ${PERIOD_STATUS_LABELS[status]}`}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PeriodPanel periodId={openPeriod} onClose={() => setOpenPeriod(null)} onChanged={() => setVersion((v) => v + 1)} />
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
