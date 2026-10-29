"use client";

import Link from "next/link";
import { format, isSameMonth, isSameDay, parseISO, startOfMonth, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAsync } from "@/lib/hooks/use-async";
import { listFollowUps, listInvoices, listProspects, invoiceTotals } from "@/lib/services";
import { REFERENCE_DATE, SOURCE_LABELS, STATUS_LABELS, STATUS_ORDER } from "@/lib/constants";
import { formatFCFA } from "@/lib/utils/format";
import { DateLabel, ErrorState, KpiCard, LoadingState, StatusBadge } from "@/components/shared";

const NAVY = "#1A2B4A";
const GOLD = "#F5B700";
const now = () => parseISO(REFERENCE_DATE);

export function AdminDashboard() {
  const data = useAsync(async () => ({
    prospects: await listProspects(),
    invoices: await listInvoices(),
    followUps: await listFollowUps(),
  }));

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Impossible de charger le tableau de bord." onRetry={data.reload} />;

  const { prospects, invoices, followUps } = data.data;
  const today = now();
  const leadsThisMonth = prospects.filter((p) => isSameMonth(parseISO(p.createdAt), today)).length;
  const clientsCount = prospects.filter((p) => p.status === "client").length;
  const conversion = prospects.length ? (clientsCount / prospects.length) * 100 : 0;
  const forecast = prospects
    .filter((p) => p.status === "en_negociation")
    .reduce((s, p) => s + (p.estimatedValue ?? 0), 0);
  const overdue = invoices
    .filter((i) => i.status === "en_retard")
    .reduce((s, i) => s + invoiceTotals(i).ttc, 0);

  const bySource = Object.entries(SOURCE_LABELS).map(([key, label]) => ({
    label,
    leads: prospects.filter((p) => p.source === key).length,
  }));
  const funnel = STATUS_ORDER.map((s) => ({ label: STATUS_LABELS[s], count: prospects.filter((p) => p.status === s).length }));
  const cashed = Array.from({ length: 6 }, (_, k) => {
    const month = startOfMonth(subMonths(today, 5 - k));
    return {
      label: format(month, "MMM", { locale: fr }),
      amount: invoices
        .filter((i) => i.status === "payee" && isSameMonth(parseISO(i.issuedAt), month))
        .reduce((s, i) => s + invoiceTotals(i).ttc, 0),
    };
  });

  const byId = new Map(prospects.map((p) => [p.id, p]));
  const dueToday = followUps
    .filter((f) => !f.done && (isSameDay(parseISO(f.dueAt), today) || parseISO(f.dueAt) < today))
    .slice(0, 6);
  const latest = [...prospects].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);

  return (
    <div className="space-y-8">
      <section aria-label="Indicateurs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Leads du mois" value={String(leadsThisMonth)} />
        <KpiCard label="Taux de conversion" value={`${conversion.toFixed(1)} %`} hint="Clients / prospects" />
        <KpiCard label="CA prévisionnel" value={formatFCFA(forecast)} hint="Prospects en négociation" />
        <KpiCard label="Factures en retard" value={formatFCFA(overdue)} />
      </section>

      <section aria-label="Graphiques" className="grid gap-6 lg:grid-cols-3">
        <figure className="rounded-lg border border-border p-4">
          <figcaption className="mb-2 font-semibold text-primary">Leads par source</figcaption>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySource} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} fontSize={12} />
                <YAxis type="category" dataKey="label" fontSize={11} width={110} />
                <Tooltip />
                <Bar dataKey="leads" name="Leads" fill={NAVY} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
        <figure className="rounded-lg border border-border p-4">
          <figcaption className="mb-2 font-semibold text-primary">Entonnoir par statut</figcaption>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" fontSize={11} interval={0} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" name="Prospects">
                  {funnel.map((f, i) => (
                    <Cell key={f.label} fill={i === 2 ? GOLD : NAVY} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
        <figure className="rounded-lg border border-border p-4">
          <figcaption className="mb-2 font-semibold text-primary">CA encaissé par mois</figcaption>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashed}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(1).replace(".0", "")} M`} fontSize={12} width={44} />
                <Tooltip formatter={(v) => formatFCFA(Number(v))} />
                <Bar dataKey="amount" name="Encaissé" fill={GOLD} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-bold text-primary">Relances à faire</h2>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {dueToday.length === 0 && <li className="p-3 text-muted-foreground">Aucune relance en attente.</li>}
            {dueToday.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 p-3">
                <Link href={`/admin/prospects/${f.prospectId}`} className="font-medium hover:underline">
                  {byId.get(f.prospectId)?.companyName}
                </Link>
                <span className="text-muted-foreground">
                  {f.rule} · <DateLabel value={f.dueAt} />
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 font-bold text-primary">Derniers prospects</h2>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {latest.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 p-3">
                <Link href={`/admin/prospects/${p.id}`} className="font-medium hover:underline">
                  {p.companyName}
                </Link>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
