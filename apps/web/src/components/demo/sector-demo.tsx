"use client";

import { AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Level } from "@manga/core/kpi/sector";
import { SECTOR_VIEWS, type SectorTabId } from "@/lib/demo/sector-views";
import { cn } from "@/lib/utils/cn";

const LEVEL_TONE: Record<Level, { tone: string; label: string; icon: typeof AlertTriangle }> = {
  alert: { tone: "border-danger/30 bg-danger/5 text-danger", label: "À traiter", icon: AlertTriangle },
  watch: { tone: "border-warning/30 bg-warning/5 text-warning", label: "À surveiller", icon: Eye },
  ok: { tone: "border-success/30 bg-success/5 text-success", label: "Satisfaisant", icon: CheckCircle2 },
};
const DOT: Record<Level, string> = { ok: "bg-success", watch: "bg-warning", alert: "bg-danger" };
const DOT_LABEL: Record<Level, string> = { ok: "dans l'objectif", watch: "à surveiller", alert: "hors objectif" };

/** Onglet sectoriel de la démo : 4 lignes (KPI, tendances, analyse métier, alertes), données fictives, FCFA. */
export function SectorDemo({ id }: { id: SectorTabId }) {
  const view = SECTOR_VIEWS[id]();
  const alerts = [...view.alerts].sort((a, b) => (a.level === b.level ? 0 : a.level === "alert" ? -1 : 1));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{view.title} · données fictives, montants en FCFA</p>

      <section aria-label="Indicateurs clés" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view.kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-background p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {k.level && <span className={cn("h-2.5 w-2.5 rounded-full", DOT[k.level])} aria-hidden />}
              {k.label}
              {k.level && <span className="sr-only"> ({DOT_LABEL[k.level]})</span>}
            </p>
            <p className="mt-1 text-2xl font-bold text-primary">{k.value}</p>
            {k.delta && <p className="mt-0.5 text-xs text-muted-foreground">{k.delta}</p>}
            {k.hint && <p className="text-xs text-muted-foreground">{k.hint}</p>}
          </div>
        ))}
      </section>

      <div className={cn("grid gap-6", view.analysis.columns.length <= 3 && "lg:grid-cols-2")}>
        <figure className="rounded-xl border border-border p-4">
          <figcaption className="mb-2 font-semibold text-primary">{view.trend.title}</figcaption>
          <div className="h-64" role="img" aria-label={view.trend.title}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={view.trend.data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit={view.trend.unit === "pct" ? " %" : ""} />
                <Tooltip />
                {view.trend.series.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {view.trend.series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: s.color }} aria-hidden />{s.label}</li>
            ))}
          </ul>
        </figure>

        <section aria-label={view.analysis.title} className="rounded-xl border border-border p-4">
          <h2 className="mb-2 font-semibold text-primary">{view.analysis.title}</h2>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>{view.analysis.columns.map((c) => <th key={c} scope="col" className="px-2 py-1.5">{c}</th>)}</tr>
              </thead>
              <tbody>
                {view.analysis.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {r.map((cell, j) => (j === 0 ? <th key={j} scope="row" className="px-2 py-1.5 text-left font-medium">{cell}</th> : <td key={j} className="whitespace-nowrap px-2 py-1.5">{cell}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section aria-label="Alertes" className="rounded-xl border border-border bg-muted/30 p-5">
        <h2 className="mb-3 text-lg font-bold text-primary">Alertes du mois</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-success">Aucune alerte : tous les indicateurs sont dans les objectifs.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {alerts.map((a, i) => {
              const { tone, label, icon: Icon } = LEVEL_TONE[a.level];
              return (
                <li key={i} className={cn("flex gap-3 rounded-lg border p-3", tone)}>
                  <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
                    <p className="text-sm text-foreground">{a.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
