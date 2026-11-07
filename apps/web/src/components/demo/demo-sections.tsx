"use client";

import { AlertTriangle, CheckCircle2, Eye, ListChecks } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SIGNIFICANT_GAP_PCT, type Insight, type InsightLevel } from "@/lib/demo/insights";
import { formatFCFA } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const NAVY = "#1A2B4A";
const GOLD = "#F5B700";
// Six distinguishable tones in the brand family (navy to gold), readable in print.
const POST_COLORS = ["#1A2B4A", "#3B5B8F", "#7A93BB", "#F5B700", "#C98F00", "#94A3B8"];
const millions = (v: number) => `${Math.round(v / 1_000_000)} M`;
const pct = (v: number, digits = 1) => `${v.toFixed(digits).replace(".", ",")} %`;

const LEVEL: Record<InsightLevel, { icon: typeof AlertTriangle; tone: string; label: string }> = {
  alerte: { icon: AlertTriangle, tone: "border-danger/30 bg-danger/5 text-danger", label: "À traiter" },
  vigilance: { icon: Eye, tone: "border-warning/30 bg-warning/5 text-warning", label: "À surveiller" },
  positif: { icon: CheckCircle2, tone: "border-success/30 bg-success/5 text-success", label: "Satisfaisant" },
};

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  const order: InsightLevel[] = ["alerte", "vigilance", "positif"];
  const sorted = [...insights].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  return (
    <section aria-labelledby="insights-title" className="rounded-xl border border-border bg-muted/30 p-5">
      <h2 id="insights-title" className="text-lg font-bold text-primary">Lecture du consultant</h2>
      <p className="mb-4 text-sm text-muted-foreground">Ce que disent les chiffres de la période choisie, du plus urgent au plus rassurant.</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {sorted.map((i) => {
          const { icon: Icon, tone, label } = LEVEL[i.level];
          return (
            <li key={i.title} className={cn("flex gap-3 rounded-lg border p-3", tone)}>
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
                <p className="font-semibold text-foreground">{i.title}</p>
                <p className="text-sm text-muted-foreground">{i.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CostMixChart({ data }: { data: { post: string; value: number; share: number }[] }) {
  return (
    <figure className="rounded-lg border border-border p-4">
      <figcaption className="mb-2 font-semibold text-primary">Répartition des charges par poste</figcaption>
      <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="post" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none">
                {data.map((_, i) => <Cell key={i} fill={POST_COLORS[i % POST_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => formatFCFA(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-1.5 text-sm">
          {data.map((d, i) => (
            <li key={d.post} className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: POST_COLORS[i % POST_COLORS.length] }} aria-hidden />
              <span className="flex-1">{d.post}</span>
              <span className="font-medium tabular-nums">{pct(d.share)}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

export function ProductMixChart({ data }: { data: { product: string; ca: number; share: number }[] }) {
  return (
    <figure className="rounded-lg border border-border p-4">
      <figcaption className="mb-2 font-semibold text-primary">Chiffre d&apos;affaires par activité</figcaption>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" tickFormatter={millions} fontSize={12} />
            <YAxis type="category" dataKey="product" fontSize={12} width={96} />
            <Tooltip formatter={(v) => formatFCFA(Number(v))} />
            <Bar dataKey="ca" name="CA" fill={NAVY} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {data.map((d) => `${d.product} ${pct(d.share, 0)}`).join(" · ")}
      </p>
    </figure>
  );
}

export function BudgetChart({ data }: { data: { post: string; prevu: number; reel: number }[] }) {
  return (
    <figure className="rounded-lg border border-border p-4 lg:col-span-2">
      <figcaption className="mb-2 font-semibold text-primary">Prévisionnel contre pratiqué, par poste de charge</figcaption>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="post" fontSize={12} />
            <YAxis tickFormatter={millions} fontSize={12} width={48} />
            <Tooltip formatter={(v) => formatFCFA(Number(v))} />
            <Legend />
            <Bar dataKey="prevu" name="Prévu (CPro)" fill="#94A3B8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="reel" name="Pratiqué (CPra)" fill={GOLD} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function HotelTable({ rows }: { rows: { id: string; hotel: string; ca: number; charges: number; resultat: number; marge: number; ecartBudget: number; satisfaction: number; rang: number }[] }) {
  return (
    <section aria-labelledby="hotels-title">
      <h2 id="hotels-title" className="mb-1 text-lg font-bold text-primary">Synthèse par établissement</h2>
      <p className="mb-3 text-xs text-muted-foreground">Classement par marge brute sur la période. L&apos;écart au prévisionnel compare les charges pratiquées au budget.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Résultat, marge et écart au prévisionnel par établissement</caption>
          <thead className="bg-muted text-left">
            <tr>
              <th scope="col" className="px-3 py-2">Rang</th>
              <th scope="col" className="px-3 py-2">Établissement</th>
              <th scope="col" className="px-3 py-2 text-right">CA</th>
              <th scope="col" className="px-3 py-2 text-right">Résultat</th>
              <th scope="col" className="px-3 py-2 text-right">Marge</th>
              <th scope="col" className="px-3 py-2 text-right">Écart charges</th>
              <th scope="col" className="px-3 py-2 text-right">Satisfaction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-semibold text-primary">{r.rang}</td>
                <td className="px-3 py-2">{r.hotel}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatFCFA(r.ca)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatFCFA(r.resultat)}</td>
                <td className="px-3 py-2 text-right font-medium">{pct(r.marge)}</td>
                <td className={cn("px-3 py-2 text-right font-medium", r.ecartBudget > SIGNIFICANT_GAP_PCT ? "text-danger" : r.ecartBudget > 3 ? "text-warning" : "text-success")}>
                  {r.ecartBudget > 0 ? "+" : ""}{pct(r.ecartBudget)}
                </td>
                <td className="px-3 py-2 text-right">{r.satisfaction.toFixed(1)} / 5</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ActionPlan({ items }: { items: { priority: number; post: string; impact: number; gapPct: number; action: string }[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="actions-title">
      <h2 id="actions-title" className="mb-1 flex items-center gap-2 text-lg font-bold text-primary">
        <ListChecks className="h-5 w-5" aria-hidden /> Plan d&apos;actions recommandé
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">Classé par impact financier : les écarts défavorables les plus coûteux d&apos;abord.</p>
      <ol className="space-y-3">
        {items.map((a) => (
          <li key={a.post} className="flex gap-4 rounded-lg border border-border p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{a.priority}</span>
            <div>
              <p className="font-semibold text-primary">
                {a.post} <span className="ml-1 text-sm font-normal text-danger">+{formatFCFA(a.impact)} ({pct(a.gapPct)})</span>
              </p>
              <p className="text-sm text-muted-foreground">{a.action}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Methodology() {
  return (
    <details className="group rounded-lg border border-border p-4">
      <summary className="cursor-pointer font-semibold text-primary list-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
        Méthodologie et définitions
      </summary>
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
        {[
          ["Marge brute", "(Chiffre d'affaires − charges pratiquées) ÷ chiffre d'affaires."],
          ["CPro / CPra", "Charges prévues (budget) et charges pratiquées (réalisé), par poste de dépense. Libellés provisoires, à confirmer avec le client."],
          ["Écart significatif", `Écart de plus de ${SIGNIFICANT_GAP_PCT} % entre le pratiqué et le prévu sur un poste : il déclenche une alerte et une action.`],
          ["Point mort", "Chiffre d'affaires à partir duquel les charges sont couvertes. Hypothèse provisoire : 60 % de charges fixes, 40 % de variables."],
          ["Taux de couverture", "Chiffre d'affaires ÷ charges pratiquées. Formule provisoire, à confirmer."],
          ["Période de comparaison", "Chaque indicateur est comparé à la période précédente de même durée (mois, trimestre ou année)."],
        ].map(([term, definition]) => (
          <div key={term}>
            <dt className="font-medium">{term}</dt>
            <dd className="text-muted-foreground">{definition}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Toutes les données de cette page sont fictives et générées pour la démonstration.</p>
    </details>
  );
}
