"use client";

import { useState } from "react";
import { useAsync } from "@/lib/hooks/use-async";
import { getClientPilotResults } from "@/lib/services/pilot";
import { cn } from "@/lib/utils/cn";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";
import { EcartsView } from "./ecarts-view";
import { KpiView } from "./kpi-view";

/**
 * Pilote hôtellerie, espace client (avenant §10) : la direction et l'analyste voient les écarts CPRO / CPRA et
 * les KPI de leurs hôtels, en lecture seule, une fois les mois validés par le consultant.
 */
export function PilotClient() {
  const data = useAsync(getClientPilotResults);
  const [tab, setTab] = useState<"ecarts" | "kpi">("ecarts");

  return (
    <section aria-label="Pilote hôtellerie" className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-primary">Pilote hôtellerie</h2>
        <p className="text-sm text-muted-foreground">Consommables et indicateurs de vos hôtels, en lecture seule. Un mois apparaît après sa validation par votre consultant.</p>
      </div>
      <div role="tablist" aria-label="Pilote hôtellerie" className="flex gap-1 border-b border-border">
        {([["ecarts", "Écarts CPRO / CPRA"], ["kpi", "KPI hôteliers"]] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === id ? "border-accent text-primary" : "border-transparent text-muted-foreground hover:text-primary")}>
            {label}
          </button>
        ))}
      </div>
      {data.status === "loading" && <LoadingState />}
      {data.status === "error" && <ErrorState message="Résultats indisponibles." onRetry={data.reload} />}
      {data.status === "success" && data.data.results.length === 0 && <EmptyState message="Aucun résultat validé pour le moment. Un mois apparaît après sa validation par votre consultant." />}
      {data.status === "success" && data.data.results.length > 0 && (tab === "ecarts" ? <EcartsView data={data.data} /> : <KpiView data={data.data} showAlerts={false} />)}
    </section>
  );
}
