"use client";

import { useState } from "react";
import { Download, FileArchive } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { exportUrl, getCollectionOverview, monthKey } from "@/lib/services/collection";
import { USE_DB } from "@/lib/services/data-source";
import { collectionTemplates } from "@/lib/mock/collection";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";

/** Export consolidé (avenant §8) : un seul fichier Excel par modèle et par plage de périodes. */
export function ConsolidatedExports() {
  const data = useAsync(getCollectionOverview);
  const [template, setTemplate] = useState(collectionTemplates[0].id);
  const [client, setClient] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Exports indisponibles." onRetry={data.reload} />;
  const { months, clients, rows } = data.data;
  const start = from || months[0].key;
  const end = to || months.at(-1)!.key;

  const matching = rows.filter((r) => r.template.id === template && (client === "all" || r.client.id === client));
  const periods = matching.flatMap((r) => r.periods).filter((p) => {
    const key = monthKey(p);
    return key >= start && key <= end;
  });
  const usable = periods.filter((p) => p.status === "VALIDE" || p.status === "ACCEPTE_AVEC_RESERVE");
  const missing = periods.filter((p) => ["ATTENDU", "EN_RETARD", "EN_CONTROLE", "REJETE"].includes(p.status));
  const download = (format: "xlsx" | "zip") => () => {
    if (!USE_DB) return toast.info("Export disponible avec la base de données (DATA_SOURCE=db)");
    window.location.assign(exportUrl({ templateId: template, from: start, to: end, ...(client !== "all" ? { clientId: client } : {}) }, format));
  };

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Un seul fichier Excel contenant toutes les lignes des dépôts validés (ou acceptés avec réserve), préfixées par client, entité, période et version. Une feuille « Suivi » liste les entités manquantes.
      </p>
      <div className="grid max-w-3xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Modèle" htmlFor="ex-template">
          <Select id="ex-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {collectionTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Client" htmlFor="ex-client">
          <Select id="ex-client" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="all">Tous</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Du mois" htmlFor="ex-from">
          <Select id="ex-from" value={start} onChange={(e) => setFrom(e.target.value)}>
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Au mois" htmlFor="ex-to">
          <Select id="ex-to" value={end} onChange={(e) => setTo(e.target.value)}>
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
        <Count label="Dépôts inclus" value={usable.length} />
        <Count label="Périodes manquantes ou non validées" value={missing.length} warn={missing.length > 0} />
        <Count label="Entités concernées" value={matching.length} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="accent" disabled={usable.length === 0} onClick={download("xlsx")}>
          <Download className="h-4 w-4" aria-hidden /> Télécharger l&apos;export consolidé (.xlsx)
        </Button>
        <Button variant="outline" disabled={usable.length === 0} onClick={download("zip")}>
          <FileArchive className="h-4 w-4" aria-hidden /> Fichiers originaux (.zip)
        </Button>
      </div>
    </div>
  );
}

function Count({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={warn ? "mt-1 text-2xl font-bold text-danger" : "mt-1 text-2xl font-bold text-primary"}>{value}</p>
    </div>
  );
}
