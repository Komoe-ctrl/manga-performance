"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, Info, TrendingDown, TrendingUp } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { HotelAlertLevel } from "@manga/core/kpi/hotel";
import type { PilotResults } from "@/lib/services/pilot";
import { Field, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";
import { CHART_COLORS, fcfa, num, pct } from "./format";

export const ALERT_STYLE: Record<HotelAlertLevel, { icon: typeof Info; tone: string; label: string }> = {
  alert: { icon: AlertTriangle, tone: "border-danger/30 bg-danger/5 text-danger", label: "À traiter" },
  watch: { icon: Eye, tone: "border-warning/30 bg-warning/5 text-warning", label: "À surveiller" },
  info: { icon: CheckCircle2, tone: "border-success/30 bg-success/5 text-success", label: "Information" },
  missing: { icon: Info, tone: "border-accent/40 bg-accent/10 text-accent-foreground", label: "Donnée manquante" },
};

/**
 * KPI hôteliers (avenant §10 et §11 bis) : par hôtel et par mois, cartes avec comparaison au mois précédent,
 * alertes, structure des coûts. Le GOP est calculé par la plateforme, jamais saisi.
 */
export function KpiView({ data, showAlerts = true }: { data: PilotResults; showAlerts?: boolean }) {
  // En base, un mois peut n'avoir que des écarts CPRO / CPRA : on ne propose que les mois avec KPI.
  const hotels = data.hotels.filter((h) => data.results.some((r) => r.hotelId === h.id && r.hasKpis !== false));
  const months = data.months.filter((m) => data.results.some((r) => r.monthKey === m.key && r.hasKpis !== false));
  const [hotel, setHotel] = useState(hotels[0]?.id ?? "");
  const [month, setMonth] = useState(months.at(-1)?.key ?? "");

  const index = months.findIndex((m) => m.key === month);
  const current = data.results.find((r) => r.hotelId === hotel && r.monthKey === month && r.hasKpis !== false);
  const previous = index > 0 ? data.results.find((r) => r.hotelId === hotel && r.monthKey === months[index - 1]!.key && r.hasKpis !== false) : undefined;
  if (!current || hotels.length === 0 || months.length === 0) return null;
  const k = current.kpis;
  const p = previous?.kpis;

  const cards: { label: string; value: string; now: number | null; before: number | null | undefined; hint: string; lowerIsBetter?: boolean }[] = [
    { label: "RevPAR", value: fcfa(k.revpar === null ? null : Math.round(k.revpar)), now: k.revpar, before: p?.revpar, hint: "CA chambres / chambres disponibles" },
    { label: "TRevPAR", value: fcfa(k.trevpar === null ? null : Math.round(k.trevpar)), now: k.trevpar, before: p?.trevpar, hint: "Revenus totaux / chambres disponibles" },
    { label: "GOP", value: fcfa(k.gop), now: k.gop, before: p?.gop, hint: "Revenus − charges départementales − charges non réparties" },
    { label: "GOPPAR", value: fcfa(k.goppar === null ? null : Math.round(k.goppar)), now: k.goppar, before: p?.goppar, hint: "GOP / chambres disponibles" },
    { label: "GOP Margin", value: pct(k.gopMarginPct), now: k.gopMarginPct, before: p?.gopMarginPct, hint: "GOP / revenus totaux" },
    { label: "Taux d'occupation", value: pct(k.tauxOccupationPct), now: k.tauxOccupationPct, before: p?.tauxOccupationPct, hint: "Chambres vendues / chambres disponibles" },
    { label: "ADR", value: fcfa(k.adr === null ? null : Math.round(k.adr)), now: k.adr, before: p?.adr, hint: "CA chambres / chambres vendues" },
    { label: "Poids des OTA", value: pct(k.poidsOtaPct), now: k.poidsOtaPct, before: p?.poidsOtaPct, hint: "Commissions OTA / CA chambres (proposition, à valider)", lowerIsBetter: true },
  ];

  const s = current.structure;
  const revenue = s.chargesDepartementales + s.chargesNonReparties + Math.max(0, s.gop);
  const structure = [
    { name: "Charges départementales", value: s.chargesDepartementales },
    { name: "Charges non réparties", value: s.chargesNonReparties },
    { name: "GOP", value: Math.max(0, s.gop) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Hôtel" htmlFor="kpi-hotel">
          <Select id="kpi-hotel" value={hotel} onChange={(e) => setHotel(e.target.value)}>
            {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select>
        </Field>
        <Field label="Mois" htmlFor="kpi-month">
          <Select id="kpi-month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
        <p className="ml-auto text-sm text-muted-foreground">{num(k.chambresDisponibles)} chambres disponibles sur la période</p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicateurs du mois">
        {cards.map((c) => {
          const delta = c.now !== null && c.before !== null && c.before !== undefined && c.before !== 0 ? ((c.now - c.before) * 100) / Math.abs(c.before) : null;
          const better = delta === null ? null : c.lowerIsBetter ? delta < 0 : delta > 0;
          return (
            <li key={c.label} className="rounded-xl border border-border bg-background p-4">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-primary">{c.value}</p>
              <p className="mt-0.5 min-h-4 text-xs text-muted-foreground">{c.hint}</p>
              <p className={cn("mt-1 flex items-center gap-1 text-xs font-medium", delta === null ? "text-muted-foreground" : better ? "text-success" : "text-danger")}>
                {delta === null ? (
                  "Pas de mois précédent comparable"
                ) : (
                  <>
                    {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                    {delta >= 0 ? "+" : ""}{num(delta, 1)} % vs mois précédent
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      <div className={cn("grid gap-4", showAlerts && "lg:grid-cols-2")}>
        {showAlerts && (
          <section aria-label="Alertes" className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
            <h3 className="font-semibold text-primary">Alertes du mois</h3>
            {current.alerts.length === 0 && <p className="text-sm text-success">Aucune alerte : les indicateurs sont dans les seuils.</p>}
            <ul className="space-y-2">
              {current.alerts.map((a) => {
                const { icon: Icon, tone, label } = ALERT_STYLE[a.level];
                return (
                  <li key={a.code} className={cn("flex gap-3 rounded-lg border p-3", tone)}>
                    <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
                      <p className="text-sm text-foreground">{a.message}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <figure className="rounded-xl border border-border bg-background p-4">
          <figcaption className="mb-2 font-semibold text-primary">Structure des revenus d&apos;exploitation</figcaption>
          <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
            <div className="h-52" role="img" aria-label="Répartition des revenus entre charges départementales, charges non réparties et GOP.">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={structure} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="none">
                    {structure.map((_, i) => <Cell key={i} fill={CHART_COLORS[[0, 2, 3][i]!]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fcfa(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-1.5 text-sm">
              {structure.map((d, i) => (
                <li key={d.name} className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: CHART_COLORS[[0, 2, 3][i]!] }} aria-hidden />
                  <span className="flex-1">{d.name}</span>
                  <span className="font-medium tabular-nums">{pct(revenue === 0 ? null : (d.value * 100) / revenue)}</span>
                </li>
              ))}
            </ul>
          </div>
        </figure>
      </div>
    </div>
  );
}
