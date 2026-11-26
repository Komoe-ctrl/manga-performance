"use client";

import { useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { USE_DB } from "@/lib/services/data-source";
import { getPilotResults, getPilotVersions, recomputePilot } from "@/lib/services/pilot";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";
import { CpraSettings } from "./cpra-settings";
import { PilotAdminDb } from "./pilot-admin-db";
import { EcartsView } from "./ecarts-view";
import { KpiView } from "./kpi-view";

const TABS = [
  { id: "ecarts", label: "Écarts CPRO / CPRA" },
  { id: "kpi", label: "KPI hôteliers" },
  { id: "parametres", label: "Paramètres CPRA" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Pilote hôtellerie, côté consultant (avenant §10) : écarts, KPI, paramètres, recalcul versionné. */
export function PilotAdmin() {
  // `db` : dépôts réels, versions calculées et validation par le consultant. `mock` : démonstration.
  return USE_DB ? <PilotAdminDb /> : <PilotAdminDemo />;
}

function PilotAdminDemo() {
  const [tab, setTab] = useState<Tab>("ecarts");
  const [version, setVersion] = useState<number | undefined>();
  const [refresh, setRefresh] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const results = useAsync(() => getPilotResults(version), [version, refresh]);
  const versions = useAsync(getPilotVersions, [refresh]);

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

      <section aria-label="Calcul" className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-background p-4">
        <Field label="Version du calcul" htmlFor="pilot-version">
          <Select id="pilot-version" value={version ?? ""} onChange={(e) => setVersion(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Dernière version</option>
            {versions.status === "success" && versions.data.map((v) => <option key={v.version} value={v.version}>Version {v.version} — {formatDate(v.at)}</option>)}
          </Select>
        </Field>
        <Field label="Motif du recalcul" htmlFor="pilot-note">
          <Input id="pilot-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. nouvelle norme gel douche" className="w-64" />
        </Field>
        <Button
          type="button"
          variant="accent"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const created = await recomputePilot(note);
              toast.success(`Recalcul terminé : version ${created}. Les versions précédentes restent consultables.`);
              setNote("");
              setVersion(undefined);
              setRefresh((r) => r + 1);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Recalculer
        </Button>
        {versions.status === "success" && (
          <details className="ml-auto text-sm">
            <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground"><History className="h-4 w-4" aria-hidden /> Historique des versions ({versions.data.length})</summary>
            <ul className="mt-2 space-y-1">
              {versions.data.map((v) => <li key={v.version}><strong>Version {v.version}</strong> · {formatDate(v.at)} · {v.by} · {v.note}</li>)}
            </ul>
          </details>
        )}
      </section>

      {results.status === "success" && results.data.stale && (
        <p role="status" className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
          Les paramètres ont été modifiés depuis la version {results.data.version} : les résultats ci-dessous ne les prennent pas encore en compte. Lancez un recalcul.
        </p>
      )}

      <div role="tabpanel" id={`pilot-panel-${tab}`} aria-labelledby={`pilot-tab-${tab}`}>
        {tab === "parametres" ? (
          <CpraSettings onSaved={() => setRefresh((r) => r + 1)} />
        ) : results.status === "loading" ? (
          <LoadingState />
        ) : results.status === "error" ? (
          <ErrorState message="Résultats indisponibles." onRetry={results.reload} />
        ) : tab === "ecarts" ? (
          <EcartsView key={results.data.version} data={results.data} />
        ) : (
          <KpiView key={results.data.version} data={results.data} />
        )}
      </div>
    </div>
  );
}
