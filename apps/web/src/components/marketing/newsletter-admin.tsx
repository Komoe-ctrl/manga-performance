"use client";

import { useState } from "react";
import { useAsync } from "@/lib/hooks/use-async";
import { listSubscribers } from "@/lib/services";
import type { NewsletterSubscriber } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { ExportButtons } from "@/components/shared/export-buttons";
import { DateLabel, ErrorState, KpiCard, LoadingState } from "@/components/shared";
import { DataTable, type Column } from "@/components/shared/data-table";

type State = "confirme" | "en_attente" | "desinscrit";
const stateOf = (s: NewsletterSubscriber): State => (s.unsubscribedAt ? "desinscrit" : s.confirmed ? "confirme" : "en_attente");
const LABELS: Record<State, [string, string]> = {
  confirme: ["Confirmé", "bg-green-100 text-green-800"],
  en_attente: ["En attente", "bg-orange-100 text-orange-800"],
  desinscrit: ["Désinscrit", "bg-slate-100 text-slate-700"],
};

const columns: Column<NewsletterSubscriber>[] = [
  { id: "email", header: "Email", sortValue: (s) => s.email, cell: (s) => s.email },
  {
    id: "state",
    header: "Statut",
    sortValue: (s) => stateOf(s),
    cell: (s) => {
      const [label, tone] = LABELS[stateOf(s)];
      return <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", tone)}>{label}</span>;
    },
  },
  { id: "subscribedAt", header: "Inscrit le", sortValue: (s) => s.subscribedAt, cell: (s) => <DateLabel value={s.subscribedAt} /> },
];

export function NewsletterAdmin() {
  const subs = useAsync(listSubscribers);
  const [filter, setFilter] = useState<State | "all">("all");

  if (subs.status === "loading") return <LoadingState />;
  if (subs.status === "error") return <ErrorState message="Abonnés indisponibles." onRetry={subs.reload} />;

  const count = (s: State) => subs.data.filter((x) => stateOf(x) === s).length;
  const rows = subs.data.filter((s) => filter === "all" || stateOf(s) === filter);

  return (
    <div className="space-y-4">
      <section aria-label="Compteurs" className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Confirmés" value={String(count("confirme"))} />
        <KpiCard label="En attente de confirmation" value={String(count("en_attente"))} hint="Double opt-in" />
        <KpiCard label="Désinscrits" value={String(count("desinscrit"))} />
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filtrer par statut" className="flex gap-2">
          {(["all", "confirme", "en_attente", "desinscrit"] as const).map((v) => (
            <button
              key={v}
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
              className={cn("rounded-full border px-3 py-1 text-sm", filter === v ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted")}
            >
              {v === "all" ? "Tous" : LABELS[v][0]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <ExportButtons kind="subscribers" filters={{ status: filter === "all" ? undefined : filter }} />
        </div>
      </div>
      <DataTable data={rows} columns={columns} getRowId={(s) => s.id} caption="Abonnés à la newsletter" emptyMessage="Aucun abonné dans ce statut." />
    </div>
  );
}
