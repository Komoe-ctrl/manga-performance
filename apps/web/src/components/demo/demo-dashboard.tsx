"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAsync } from "@/lib/hooks/use-async";
import { getDemoDashboard } from "@/lib/services";
import { aggregate, byHotel, monthlySeries, periods, variances, type Filters, type Granularity } from "@/lib/demo/compute";
import { demoHotelReading } from "@/lib/demo/hotel-kpis";
import { SIGNIFICANT_GAP_PCT, actionPlan, budgetVsActual, costMix, hotelSummary, productMix } from "@/lib/demo/insights";
import { demoConsumables } from "@/lib/mock/pilot";
import { COST_POSTS, DEMO_PRODUCTS } from "@/lib/mock/demo-dashboard";
import { formatFCFA } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { ExportButtons } from "@/components/shared/export-buttons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";
import { LeadModal } from "./lead-modal";
import { EcartsView } from "@/components/pilot/ecarts-view";
import { ActionPlan, BudgetChart, CostMixChart, HotelTable, Methodology, ProductMixChart } from "./demo-sections";
import { ConsultantReading, HotelKpiCards } from "./hotel-kpis";

const NAVY = "#1A2B4A";
const GOLD = "#F5B700";

const monthLabel = (m: string) => format(parseISO(`${m}-01`), "MMM yy", { locale: fr });
const millions = (v: number) => `${Math.round(v / 1_000_000)} M`;

function Kpi({ label, value, delta, unit = "%", hint }: { label: string; value: string; delta?: number; unit?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
      {delta !== undefined && (
        <p className={cn("mt-1 text-xs font-medium", delta >= 0 ? "text-success" : "text-danger")}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} {unit} vs période précédente
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function DemoDashboard() {
  const data = useAsync(getDemoDashboard);
  const [filters, setFilters] = useState<Filters>({ hotelId: "all", productId: "all", granularity: "trimestre" });
  const [leadOpen, setLeadOpen] = useState(false);

  const view = useMemo(() => {
    if (data.status !== "success") return null;
    const d = data.data;
    const p = periods(d.months, filters.granularity);
    const cur = aggregate(d, filters, p.current);
    const prev = aggregate(d, filters, p.previous);
    const gaps = variances(d, filters, p.current);
    const summary = hotelSummary(d, filters.productId, p.current);
    const payroll = gaps.find((g) => g.id === "personnel")?.actual ?? 0;
    return {
      cur,
      prev,
      series: monthlySeries(d, filters),
      hotels: byHotel(d, filters.productId, p.current),
      gaps,
      summary,
      mix: costMix(d, filters, p.current, COST_POSTS),
      products: productMix(d, filters.hotelId, p.current, DEMO_PRODUCTS),
      budget: budgetVsActual(gaps),
      reading: demoHotelReading(d, filters.hotelId, p.current, p.previous),
      actions: actionPlan(gaps),
      payrollRatio: cur.revenue ? (payroll / cur.revenue) * 100 : 0,
      significantGaps: gaps.filter((g) => g.gapPct > SIGNIFICANT_GAP_PCT).length,
    };
  }, [data, filters]);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Impossible de charger la démo." onRetry={data.reload} />;
  if (!view) return null;

  const { cur } = view;
  const { hotels } = data.data;
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  // The consumables block always shows the six last closed months of the three fictitious hotels.
  const consumables = { version: 1, stale: false, ...demoConsumables(), validatedUntil: "" };

  return (
    <div className="space-y-8">
      <div role="note" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
        Données fictives — exemple de livrable MANGA PERFORMANCE
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Hôtel</span>
          <Select value={filters.hotelId} onChange={(e) => set("hotelId", e.target.value)}>
            <option value="all">Tous</option>
            {hotels.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Période</span>
          <Select value={filters.granularity} onChange={(e) => set("granularity", e.target.value as Granularity)}>
            <option value="mois">Dernier mois</option>
            <option value="trimestre">Dernier trimestre</option>
            <option value="annee">Dernière année</option>
          </Select>
        </label>
        <div className="ml-auto flex gap-2">
          <ExportButtons kind="demo" filters={{ ...filters }} />
        </div>
      </div>

      <HotelKpiCards kpis={view.reading.kpis} previous={view.reading.previous} />

      <ConsultantReading alerts={view.reading.alerts} />

      <section aria-label="Maîtrise des coûts" className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Charges / revenus" value={`${(cur.revenue ? (cur.charges / cur.revenue) * 100 : 0).toFixed(1).replace(".", ",")} %`} hint="Plus ce ratio est bas, meilleure est la marge." />
        <Kpi label="Masse salariale / revenus" value={`${view.payrollRatio.toFixed(1).replace(".", ",")} %`} hint="Premier poste de charges : à comparer au budget." />
        <Kpi label="Postes en écart significatif" value={`${view.significantGaps} / ${view.gaps.length}`} hint={`Seuil : ${SIGNIFICANT_GAP_PCT} % au-dessus du budget.`} />
      </section>

      <section aria-label="Graphiques" className="grid gap-6 lg:grid-cols-2">
        <figure className="rounded-lg border border-border p-4 lg:col-span-2">
          <figcaption className="mb-2 font-semibold text-primary">Évolution mensuelle du CA et des charges</figcaption>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={view.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tickFormatter={monthLabel} fontSize={12} />
                <YAxis tickFormatter={millions} fontSize={12} width={48} />
                <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v) => formatFCFA(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="ca" name="CA" stroke={NAVY} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="charges" name="Charges" stroke={GOLD} strokeWidth={2} strokeDasharray="5 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </figure>

        <figure className="rounded-lg border border-border p-4">
          <figcaption className="mb-2 font-semibold text-primary">Comparaison entre hôtels (période)</figcaption>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.hotels}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hotel" fontSize={11} tickFormatter={(n: string) => n.split(" (")[0]} />
                <YAxis tickFormatter={millions} fontSize={12} width={48} />
                <Tooltip formatter={(v) => formatFCFA(Number(v))} />
                <Legend />
                <Bar dataKey="ca" name="CA" fill={NAVY} />
                <Bar dataKey="charges" name="Charges" fill={GOLD} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>

        <figure className="rounded-lg border border-border p-4">
          <figcaption className="mb-2 font-semibold text-primary">Tendance de la GOP Margin (%)</figcaption>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={view.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tickFormatter={monthLabel} fontSize={12} />
                <YAxis unit=" %" fontSize={12} width={48} domain={["auto", "auto"]} />
                <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v) => `${v} %`} />
                <Line type="monotone" dataKey="marge" name="GOP Margin" stroke={NAVY} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </figure>

        <CostMixChart data={view.mix} />
        <ProductMixChart data={view.products} />
        <BudgetChart data={view.budget} />
      </section>

      <HotelTable rows={view.summary} />

      <section aria-label="Écarts par poste de charge">
        <h2 className="mb-1 text-lg font-bold text-primary">Écarts par poste de charge</h2>
        <p className="mb-3 text-xs text-muted-foreground">Budget et réalisé de la période, poste par poste. Un écart positif est une dépense au-dessus du budget.</p>
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Budget, réalisé et écart par poste de charge</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th scope="col" className="px-3 py-2">Poste</th>
                <th scope="col" className="px-3 py-2 text-right">Budget</th>
                <th scope="col" className="px-3 py-2 text-right">Réalisé</th>
                <th scope="col" className="px-3 py-2 text-right">Écart</th>
                <th scope="col" className="px-3 py-2 text-right">Écart %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.gaps.map((g) => (
                <tr key={g.post}>
                  <td className="px-3 py-2">{g.post}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatFCFA(g.budget)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatFCFA(g.actual)}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right font-medium", g.gap > 0 ? "text-danger" : "text-success")}>
                    {g.gap > 0 ? "+" : ""}{formatFCFA(g.gap)}
                  </td>
                  <td className={cn("px-3 py-2 text-right font-medium", g.gap > 0 ? "text-danger" : "text-success")}>
                    {g.gapPct > 0 ? "+" : ""}{g.gapPct.toFixed(1)} %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="consumables-title" className="space-y-3">
        <div>
          <h2 id="consumables-title" className="text-lg font-bold text-primary">Consommables : écarts CPRO / CPRA</h2>
          <p className="text-sm text-muted-foreground">
            CPRO : ce qui a été livré. CPRA : la consommation théorique selon la norme et la population accueillie. La couverture est CPRO ÷ CPRA ; l&apos;écart valorisé est positif en cas de sur-distribution.
          </p>
        </div>
        <EcartsView data={consumables} fixedHotel={filters.hotelId} />
      </section>

      <ActionPlan items={view.actions} />
      <Methodology />

      <div className="rounded-lg bg-primary p-6 text-center text-primary-foreground">
        <p className="font-semibold">Un tableau de bord comme celui-ci, pour votre entreprise ?</p>
        <Button variant="accent" size="lg" className="mt-3" onClick={() => setLeadOpen(true)}>
          Je veux ce tableau de bord pour mon entreprise
        </Button>
      </div>
      <LeadModal open={leadOpen} onClose={() => setLeadOpen(false)} />
    </div>
  );
}
