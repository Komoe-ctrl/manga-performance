"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Info, Play } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { createScrapeJob, listScrapeJobs, SCRAPE_DURATION_MS } from "@/lib/services";
import { CITIES, SECTORS, SIZE_LABELS } from "@/lib/constants";
import type { CompanySize, ScrapeJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { DateLabel, ErrorState, LoadingState } from "@/components/shared";
import { DataTable, type Column } from "@/components/shared/data-table";

export const SOURCE_LABELS: Record<ScrapeJob["source"], string> = {
  annuaire: "Annuaires professionnels",
  appels_offres: "Sites d'appels d'offres",
  site_web: "Sites web d'entreprises",
};
const STATUS_LABELS: Record<ScrapeJob["status"], string> = { en_cours: "En cours", termine: "Terminé", echec: "Échec" };

export function ComplianceNote() {
  return (
    <div role="note" className="flex gap-2 rounded-lg border border-border bg-muted p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>
        Conformité : la collecte respecte la loi ivoirienne n° 2013-450 sur la protection des données à caractère personnel.
        Données publiques uniquement, dans le respect des CGU de chaque source. LinkedIn n&apos;est pas utilisé.
      </p>
    </div>
  );
}

function RunningJob({ job, onDone }: { job: ScrapeJob; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const start = new Date(job.startedAt).getTime();
    const timer = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / SCRAPE_DURATION_MS) * 100);
      setProgress(p);
      if (p >= 100) {
        clearInterval(timer);
        setTimeout(onDone, 300); // laisse le service marquer le job comme terminé
      }
    }, 200);
    return () => clearInterval(timer);
  }, [job.startedAt, onDone]);

  return (
    <div role="status" className="rounded-lg border border-border p-4">
      <p className="text-sm font-medium">Collecte en cours : {SOURCE_LABELS[job.source]}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

const columns: Column<ScrapeJob>[] = [
  {
    id: "source",
    header: "Source",
    sortValue: (j) => SOURCE_LABELS[j.source],
    cell: (j) => (j.status === "termine" ? <Link href={`/admin/scraper/${j.id}`} className="font-medium hover:underline">{SOURCE_LABELS[j.source]}</Link> : SOURCE_LABELS[j.source]),
  },
  {
    id: "filters",
    header: "Filtres",
    cell: (j) => [j.filters.sector, j.filters.city, j.filters.size && SIZE_LABELS[j.filters.size]].filter(Boolean).join(" · ") || "Aucun",
  },
  { id: "status", header: "Statut", sortValue: (j) => j.status, cell: (j) => STATUS_LABELS[j.status] },
  { id: "startedAt", header: "Lancé le", sortValue: (j) => j.startedAt, cell: (j) => <DateLabel value={j.startedAt} /> },
  { id: "results", header: "Résultats", sortValue: (j) => j.resultsCount, cell: (j) => (j.status === "termine" ? j.resultsCount : "—") },
];

export function ScraperHome() {
  const jobs = useAsync(listScrapeJobs);
  const [source, setSource] = useState<ScrapeJob["source"]>("annuaire");
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");
  const [size, setSize] = useState("");
  const [launching, setLaunching] = useState(false);

  const running = jobs.status === "success" ? jobs.data.find((j) => j.status === "en_cours") : undefined;
  const { reload } = jobs;

  return (
    <div className="space-y-6">
      <ComplianceNote />
      <form
        className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setLaunching(true);
          await createScrapeJob(source, {
            sector: sector || undefined,
            city: city || undefined,
            size: (size || undefined) as CompanySize | undefined,
          });
          setLaunching(false);
          toast.success("Collecte lancée (simulation)");
          reload();
        }}
      >
        <Field label="Source" htmlFor="sc-source">
          <Select id="sc-source" value={source} onChange={(e) => setSource(e.target.value as ScrapeJob["source"])}>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Secteur" htmlFor="sc-sector">
          <Select id="sc-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">Tous</option>
            {SECTORS.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Ville" htmlFor="sc-city">
          <Select id="sc-city" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Toutes</option>
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Taille" htmlFor="sc-size">
          <Select id="sc-size" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">Toutes</option>
            {Object.entries(SIZE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={launching || !!running} className="w-full">
            <Play className="h-4 w-4" aria-hidden /> Lancer
          </Button>
        </div>
      </form>

      {running && <RunningJob job={running} onDone={reload} />}

      <section aria-label="Historique des jobs">
        <h2 className="mb-2 font-bold text-primary">Historique</h2>
        {jobs.status === "loading" && <LoadingState />}
        {jobs.status === "error" && <ErrorState message="Historique indisponible." onRetry={jobs.reload} />}
        {jobs.status === "success" && (
          <DataTable
            data={[...jobs.data].sort((a, b) => b.startedAt.localeCompare(a.startedAt))}
            columns={columns}
            getRowId={(j) => j.id}
            caption="Historique des jobs de scraping"
            emptyMessage="Aucun job pour l'instant."
          />
        )}
      </section>
    </div>
  );
}
