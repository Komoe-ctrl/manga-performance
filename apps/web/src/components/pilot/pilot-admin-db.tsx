"use client";

import { useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { getPilotResults, recomputePilotPeriod, validatePilotPeriod } from "@/lib/services/pilot";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";
import { CpraSettingsDb } from "./cpra-settings-db";
import { EcartsView } from "./ecarts-view";
import { KpiView } from "./kpi-view";

const TABS = [
  { id: "ecarts", label: "Écarts CPRO / CPRA" },
  { id: "kpi", label: "KPI hôteliers" },
  { id: "parametres", label: "Paramètres CPRA" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Pilote du consultant sur les dépôts réels : résultats versionnés, validation et recalcul par période. */
export function PilotAdminDb() {
  const [tab, setTab] = useState<Tab>("ecarts");
  const [clientId, setClientId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const results = useAsync(() => getPilotResults(undefined, clientId || undefined), [clientId, refresh]);
  const reload = () => setRefresh((r) => r + 1);

  async function act(periodId: string, templateId: string, kind: "validate" | "recompute") {
    setBusy(`${kind}-${periodId}`);
    try {
      if (kind === "validate") {
        await validatePilotPeriod(periodId);
        toast.success("Résultats validés : visibles dans l'espace client.");
      } else {
        const computed = await recomputePilotPeriod(periodId, templateId, "Recalcul depuis le pilote");
        toast.success(`Nouvelle version calculée : ${computed.version}. À valider pour le client.`);
      }
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Pilote hôtellerie" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`pilot-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`pilot-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === t.id ? "border-accent text-primary" : "border-transparent text-muted-foreground hover:text-primary")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section aria-label="Validation des résultats" className="space-y-3 rounded-xl border border-border bg-background p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Client" htmlFor="pilot-client">
            <Select id="pilot-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Tous les clients</option>
              {results.status === "success" && results.data.clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <p className="ml-auto text-sm text-muted-foreground">Un mois n&apos;apparaît au client qu&apos;après validation de sa version.</p>
        </div>

        {results.status === "loading" && <LoadingState />}
        {results.status === "error" && <ErrorState message="Résultats indisponibles." onRetry={results.reload} />}
        {results.status === "success" && (results.data.periods?.length ?? 0) === 0 && <EmptyState message="Aucun résultat calculé. Déposez un modèle Hôtel — Consommables (CPRO) et population pour alimenter le pilote." />}
        {results.status === "success" && (results.data.periods?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Périodes calculées du pilote hôtellerie</caption>
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Hôtel</th>
                  <th scope="col" className="px-3 py-2">Mois</th>
                  <th scope="col" className="px-3 py-2">Modèle</th>
                  <th scope="col" className="px-3 py-2">Version</th>
                  <th scope="col" className="px-3 py-2">Statut du dépôt</th>
                  <th scope="col" className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.data.periods!.filter((p) => !clientId || p.clientId === clientId).map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-semibold text-primary">{p.hotelName}</th>
                    <td className="px-3 py-2">{p.monthLabel}</td>
                    <td className="px-3 py-2">{p.templateId === "hotel_consommables_cpro" ? "CPRO / CPRA" : "KPI mensuels"}</td>
                    <td className="px-3 py-2">v{p.version} {p.computedAt && <span className="text-xs text-muted-foreground">· {formatDate(p.computedAt)}</span>}</td>
                    <td className="px-3 py-2">{p.status}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {p.validatedAt ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Validé</span>
                        ) : (
                          <Button type="button" size="sm" variant="success" loading={busy === `validate-${p.id}`} onClick={() => void act(p.id, p.templateId, "validate")}>Valider</Button>
                        )}
                        <Button type="button" size="sm" variant="outline" loading={busy === `recompute-${p.id}`} onClick={() => void act(p.id, p.templateId, "recompute")}>
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Recalculer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div role="tabpanel" id={`pilot-panel-${tab}`} aria-labelledby={`pilot-tab-${tab}`}>
        {tab === "parametres" ? (
          clientId ? <CpraSettingsDb clientId={clientId} hotels={results.status === "success" ? results.data.hotels : []} onSaved={reload} /> : <EmptyState message="Sélectionnez un client pour gérer ses paramètres CPRA." />
        ) : results.status === "loading" ? (
          <LoadingState />
        ) : results.status === "error" ? (
          <ErrorState message="Résultats indisponibles." onRetry={results.reload} />
        ) : results.data.results.length === 0 ? (
          <EmptyState message="Aucun résultat à afficher pour cette sélection." />
        ) : tab === "ecarts" ? (
          <EcartsView key={`${clientId}-${results.data.version}`} data={results.data} />
        ) : results.data.results.some((r) => r.hasKpis) ? (
          <KpiView key={`${clientId}-${results.data.version}`} data={results.data} />
        ) : (
          <EmptyState message="Aucun dépôt de KPI mensuel : seuls les écarts CPRO / CPRA sont disponibles." />
        )}
      </div>
    </div>
  );
}
