"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PilotResults } from "@/lib/services/pilot";
import { Field, Select } from "@/components/ui/field";
import { CHART_COLORS, CoverageBadge, fcfa, num, pct, signed } from "./format";

const ALL = "all";

/**
 * Écarts CPRO / CPRA (avenant §10) : hôtels × produits pour un mois, total des écarts valorisés, couverture
 * et écarts valorisés en graphiques, évolution sur 6 mois. Lecture seule côté client.
 */
export function EcartsView({ data, fixedHotel }: { data: PilotResults; /** Filtre d'hôtel imposé par la page (la démo publique) : le sélecteur local disparaît. */ fixedHotel?: string }) {
  const [pickedHotel, setHotel] = useState(ALL);
  const hotel = fixedHotel ?? pickedHotel;
  const [month, setMonth] = useState(data.months.at(-1)?.key ?? "");

  const hotels = data.hotels.filter((h) => hotel === ALL || h.id === hotel);
  const monthLabel = data.months.find((m) => m.key === month)?.label ?? "";
  const rows = data.results.filter((r) => r.monthKey === month && hotels.some((h) => h.id === r.hotelId));
  const groupTotal = rows.reduce((sum, r) => sum + r.totalEcartValorise, 0);

  const products = useMemo(() => [...new Map(data.results.flatMap((r) => r.ecarts).map((e) => [e.productCode, e.productLabel])).entries()], [data]);

  // Coverage per product over the months: ratio of totals (CPRO sum / CPRA sum) over the selected hotels.
  const coverage = data.months.map((m) => {
    const point: Record<string, string | number | null> = { month: m.label.split(" ")[0]! };
    for (const [code] of products) {
      const lines = data.results.filter((r) => r.monthKey === m.key && hotels.some((h) => h.id === r.hotelId)).flatMap((r) => r.ecarts).filter((e) => e.productCode === code && e.cpro !== null && e.cpra > 0);
      const cpraSum = lines.reduce((s, e) => s + e.cpra, 0);
      point[code] = cpraSum > 0 ? Math.round((lines.reduce((s, e) => s + (e.cpro ?? 0), 0) * 1000) / cpraSum) / 10 : null;
    }
    return point;
  });

  const gapByProduct = products.map(([code, label]) => ({ product: label, ecart: rows.flatMap((r) => r.ecarts).filter((e) => e.productCode === code).reduce((s, e) => s + (e.ecartValorise ?? 0), 0) }));
  const evolution = data.months.map((m) => {
    const point: Record<string, string | number> = { month: m.label.split(" ")[0]! };
    for (const h of hotels) point[h.name] = data.results.find((r) => r.hotelId === h.id && r.monthKey === m.key)?.totalEcartValorise ?? 0;
    return point;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {fixedHotel === undefined && (
          <Field label="Hôtel" htmlFor="ecart-hotel">
            <Select id="ecart-hotel" value={hotel} onChange={(e) => setHotel(e.target.value)}>
              <option value={ALL}>Tous les hôtels</option>
              {data.hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Mois" htmlFor="ecart-month">
          <Select id="ecart-month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {data.months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
        <p className="ml-auto rounded-xl border border-border bg-background px-4 py-2 text-sm">
          Total des écarts valorisés ({monthLabel}) : <strong className={groupTotal > 0 ? "text-danger" : "text-success"}>{fcfa(groupTotal)}</strong>
          <span className="block text-xs text-muted-foreground">Positif = sur-consommation (CPRO − CPRA)</span>
        </p>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="sr-only">Écarts CPRO / CPRA par hôtel et par produit, {monthLabel}</caption>
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">Hôtel</th>
              <th scope="col" className="px-3 py-2">Produit</th>
              <th scope="col" className="px-3 py-2 text-right">CPRA</th>
              <th scope="col" className="px-3 py-2 text-right">CPRO</th>
              <th scope="col" className="px-3 py-2 text-right">Écart</th>
              <th scope="col" className="px-3 py-2 text-right">Couverture</th>
              <th scope="col" className="px-3 py-2 text-right">Écart valorisé</th>
              <th scope="col" className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = data.hotels.find((h) => h.id === r.hotelId)!.name;
              return r.ecarts.map((e, i) => (
                <tr key={`${r.hotelId}-${e.productCode}`} className={i === 0 ? "border-t-2 border-border" : "border-t border-border"}>
                  <th scope="row" className="px-3 py-1.5 text-left font-semibold text-primary">{i === 0 ? name : <span className="sr-only">{name}</span>}</th>
                  <td className="px-3 py-1.5">{e.productLabel}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{num(e.cpra, 1)} {e.referenceUnit === "ml" ? "ml" : "u."}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{e.cpro === null ? "—" : `${num(e.cpro, 1)} ${e.referenceUnit === "ml" ? "ml" : "u."}`}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{signed(e.ecartVolume, 1)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{pct(e.couverturePct)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{e.ecartValorise === null ? "—" : `${signed(e.ecartValorise)} FCFA`}</td>
                  <td className="px-3 py-1.5">
                    <CoverageBadge status={e.status} />
                    {e.missingConversion && <p className="mt-0.5 text-xs text-muted-foreground">Facteur manquant pour « {e.missingConversion} »</p>}
                  </td>
                </tr>
              ));
            })}
          </tbody>
          <tfoot>
            {rows.map((r) => (
              <tr key={r.hotelId} className="border-t border-border bg-muted/30 text-xs font-semibold">
                <th scope="row" colSpan={6} className="px-3 py-1.5 text-right">Total {data.hotels.find((h) => h.id === r.hotelId)!.name}</th>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{signed(r.totalEcartValorise)} FCFA</td>
                <td />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <figure className="rounded-xl border border-border bg-background p-4">
          <figcaption className="mb-2 font-semibold text-primary">Couverture CPRO / CPRA sur 6 mois (%)</figcaption>
          <div className="h-60" role="img" aria-label="Courbes de couverture par produit sur six mois. La zone conforme est comprise entre 95 et 105 %.">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={coverage}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis domain={[60, 140]} unit=" %" width={56} />
                <Tooltip formatter={(v) => (v === null || v === undefined ? "—" : `${num(Number(v), 1)} %`)} />
                <Legend />
                {products.map(([code, label], i) => (
                  <Line key={code} type="monotone" dataKey={code} name={label} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </figure>
        <figure className="rounded-xl border border-border bg-background p-4">
          <figcaption className="mb-2 font-semibold text-primary">Écart valorisé par produit — {monthLabel} (FCFA)</figcaption>
          <div className="h-60" role="img" aria-label="Écart valorisé par produit pour le mois choisi.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gapByProduct}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="product" interval={0} tick={{ fontSize: 11 }} />
                <YAxis width={64} />
                <Tooltip formatter={(v) => fcfa(Number(v))} />
                <Bar dataKey="ecart" name="Écart valorisé" fill="#1A2B4A" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      </div>

      <figure className="rounded-xl border border-border bg-background p-4">
        <figcaption className="mb-2 font-semibold text-primary">Évolution du total des écarts valorisés (FCFA)</figcaption>
        <div className="h-60" role="img" aria-label="Évolution mensuelle du total des écarts valorisés, par hôtel.">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={evolution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis width={64} />
              <Tooltip formatter={(v) => fcfa(Number(v))} />
              <Legend />
              {hotels.map((h, i) => <Line key={h.id} type="monotone" dataKey={h.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}
