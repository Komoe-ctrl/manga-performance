"use client";

import { useMemo, useState } from "react";
import { format, addDays, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
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
import { aggregate, byHotel, monthlySeries, periods, variances, variation, type Filters, type Granularity } from "@/lib/demo/compute";
import { formatFCFA } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";
import { LeadModal } from "./lead-modal";

const NAVY = "#1A2B4A";
const GOLD = "#F5B700";

const monthLabel = (m: string) => format(parseISO(`${m}-01`), "MMM yy", { locale: fr });
const millions = (v: number) => `${Math.round(v / 1_000_000)} M`;
const notAvailable = () => toast.info("Disponible dans la version finale");

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
    return {
      cur,
      prev,
      series: monthlySeries(d, filters),
      hotels: byHotel(d, filters.productId, p.current),
      gaps: variances(d, filters, p.current),
      lastMonth: p.current[p.current.length - 1],
      firstMonth: p.current[0],
    };
  }, [data, filters]);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Impossible de charger la démo." onRetry={data.reload} />;
  if (!view) return null;

  const { cur, prev } = view;
  const { hotels, products } = data.data;
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const breakEvenDate = cur.breakEvenReached
    ? format(addDays(parseISO(`${view.firstMonth}-01`), cur.breakEvenDays), "d MMM yyyy", { locale: fr })
    : "non atteint sur la période";

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
          <span className="mb-1 block font-medium">Produit</span>
          <Select value={filters.productId} onChange={(e) => set("productId", e.target.value)}>
            <option value="all">Tous</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
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
          <Button variant="outline" onClick={notAvailable}><Download className="h-4 w-4" aria-hidden /> PDF</Button>
          <Button variant="outline" onClick={notAvailable}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel</Button>
        </div>
      </div>

      <section aria-label="Indicateurs clés" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Marge brute" value={`${cur.marginRate.toFixed(1)} %`} delta={cur.marginRate - prev.marginRate} unit="pts" />
        <Kpi
          label="CA par collaborateur"
          value={formatFCFA(cur.revenuePerStaff)}
          delta={variation(cur.revenuePerStaff, prev.revenuePerStaff)}
        />
        {/* TODO: formules du point mort et du taux de couverture à confirmer par le client */}
        <Kpi
          label="Point mort"
          value={formatFCFA(cur.breakEven)}
          delta={variation(cur.breakEven, prev.breakEven)}
          hint={`Atteint : ${breakEvenDate}`}
        />
        <Kpi
          label="Taux de satisfaction"
          value={`${cur.satisfaction.toFixed(1)} / 5`}
          delta={cur.satisfaction - prev.satisfaction}
          unit="pt"
        />
      </section>
      <p className="-mt-4 text-xs text-muted-foreground">
        Taux de couverture des charges : {cur.coverageRate.toFixed(0)} % (formule provisoire, à confirmer).
      </p>

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
          <figcaption className="mb-2 font-semibold text-primary">Tendance de la marge (%)</figcaption>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={view.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tickFormatter={monthLabel} fontSize={12} />
                <YAxis unit=" %" fontSize={12} width={48} domain={["auto", "auto"]} />
                <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v) => `${v} %`} />
                <Line type="monotone" dataKey="marge" name="Marge" stroke={NAVY} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </figure>
      </section>

      <section aria-label="Analyse des écarts">
        <h2 className="mb-1 text-lg font-bold text-primary">Analyse des écarts</h2>
        {/* TODO: définitions et formules de CPro / CPra à confirmer par le client */}
        <p className="mb-3 text-xs text-muted-foreground">
          CPro (prévisionnel) / CPra (pratiqué) — libellés provisoires, définitions à confirmer.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Poste</th>
                <th className="px-3 py-2 text-right">CPro</th>
                <th className="px-3 py-2 text-right">CPra</th>
                <th className="px-3 py-2 text-right">Écart</th>
                <th className="px-3 py-2 text-right">Écart %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.gaps.map((g) => (
                <tr key={g.post}>
                  <td className="px-3 py-2">{g.post}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatFCFA(g.cpro)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatFCFA(g.cpra)}</td>
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
