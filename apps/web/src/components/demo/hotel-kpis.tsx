"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type { HotelAlert, HotelKpis } from "@manga/core/kpi/hotel";
import { ALERT_STYLE } from "@/components/pilot/kpi-view";
import { formatDelta, type DeltaKind } from "@/lib/utils/delta";
import { formatFCFA } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1).replace(".", ",")} %`);
const money = (value: number | null) => (value === null ? "—" : formatFCFA(Math.round(value)));

interface Card {
  label: string;
  value: string;
  hint: string;
  kind: DeltaKind;
  now: number | null;
  before: number | null;
}

/**
 * Les sept indicateurs hôteliers du client (avenant §11.2), avec la variation par rapport à la période précédente :
 * en points pour les taux, en pourcentage pour les montants.
 */
export function HotelKpiCards({ kpis, previous }: { kpis: HotelKpis; previous: HotelKpis }) {
  const cards: Card[] = [
    { label: "RevPAR", value: money(kpis.revpar), hint: "CA chambres / chambres disponibles", kind: "amount", now: kpis.revpar, before: previous.revpar },
    { label: "TRevPAR", value: money(kpis.trevpar), hint: "Revenus totaux / chambres disponibles", kind: "amount", now: kpis.trevpar, before: previous.trevpar },
    { label: "GOP", value: money(kpis.gop), hint: "Revenus − charges départementales − charges non réparties", kind: "amount", now: kpis.gop, before: previous.gop },
    { label: "GOPPAR", value: money(kpis.goppar), hint: "GOP / chambres disponibles", kind: "amount", now: kpis.goppar, before: previous.goppar },
    { label: "GOP Margin", value: pct(kpis.gopMarginPct), hint: "GOP / revenus totaux", kind: "ratio", now: kpis.gopMarginPct, before: previous.gopMarginPct },
    { label: "Taux d'occupation", value: pct(kpis.tauxOccupationPct), hint: "Chambres vendues / chambres disponibles", kind: "ratio", now: kpis.tauxOccupationPct, before: previous.tauxOccupationPct },
    { label: "ADR", value: money(kpis.adr), hint: "CA chambres / chambres vendues", kind: "amount", now: kpis.adr, before: previous.adr },
  ];
  return (
    <section aria-label="Indicateurs hôteliers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const delta = formatDelta(c.kind, c.now, c.before);
        return (
          <div key={c.label} className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-primary">{c.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.hint}</p>
            <p className={cn("mt-1 flex items-center gap-1 text-xs font-medium", !delta || delta.direction === "flat" ? "text-muted-foreground" : delta.direction === "up" ? "text-success" : "text-danger")}>
              {delta ? (
                <>
                  {delta.direction === "down" ? <TrendingDown className="h-3.5 w-3.5" aria-hidden /> : <TrendingUp className="h-3.5 w-3.5" aria-hidden />}
                  {delta.text} vs période précédente
                </>
              ) : (
                "Pas de période précédente comparable"
              )}
            </p>
          </div>
        );
      })}
    </section>
  );
}

/** Lecture du consultant : les alertes du §11 bis sur la période choisie (marge, profit / RevPAR, coûts, annexes). */
export function ConsultantReading({ alerts }: { alerts: HotelAlert[] }) {
  return (
    <section aria-labelledby="reading-title" className="rounded-xl border border-border bg-muted/30 p-5">
      <h2 id="reading-title" className="text-lg font-bold text-primary">Lecture du consultant</h2>
      <p className="mb-4 text-sm text-muted-foreground">Ce que disent les indicateurs de la période choisie, avec les seuils que le client a définis.</p>
      {alerts.length === 0 ? (
        <p className="text-sm text-success">Aucune alerte : les indicateurs sont dans les seuils.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {alerts.map((a) => {
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
      )}
    </section>
  );
}
