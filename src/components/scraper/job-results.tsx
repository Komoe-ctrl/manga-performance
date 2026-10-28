"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { getScrapeJob, importScrapeResults, listScrapeResults } from "@/lib/services";
import type { ScrapeResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ComplianceNote, SOURCE_LABELS } from "./scraper-home";

const MISSING_LABELS = { email: "email", phone: "téléphone", address: "adresse" } as const;

function missing(r: ScrapeResult) {
  return (Object.keys(MISSING_LABELS) as (keyof typeof MISSING_LABELS)[]).filter((k) => !r[k]);
}

function exportCsv(rows: ScrapeResult[]) {
  const head = ["Entreprise", "Secteur", "Adresse", "Téléphone", "Email"];
  const esc = (v?: string) => `"${(v ?? "").replaceAll('"', '""')}"`;
  const csv = [head.join(";"), ...rows.map((r) => [r.companyName, r.sector, r.address, r.phone, r.email].map(esc).join(";"))].join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "resultats-scraping.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const columns: Column<ScrapeResult>[] = [
  { id: "companyName", header: "Entreprise", sortValue: (r) => r.companyName, cell: (r) => <span className="font-medium">{r.companyName}</span> },
  { id: "sector", header: "Secteur", sortValue: (r) => r.sector, cell: (r) => r.sector },
  { id: "address", header: "Adresse", sortValue: (r) => r.address ?? "", cell: (r) => r.address ?? "—" },
  { id: "phone", header: "Téléphone", sortValue: (r) => r.phone ?? "", cell: (r) => r.phone ?? "—" },
  { id: "email", header: "Email", sortValue: (r) => r.email ?? "", cell: (r) => r.email ?? "—" },
  {
    id: "flags",
    header: "Contrôle",
    cell: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.importedToCrm && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Importé</span>}
        {r.duplicateOf && (
          <Link href={`/admin/prospects/${r.duplicateOf}`} className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800 underline">
            Doublon
          </Link>
        )}
        {missing(r).map((k) => (
          <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">sans {MISSING_LABELS[k]}</span>
        ))}
      </div>
    ),
  },
];

export function JobResults({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const data = useAsync(async () => ({ job: await getScrapeJob(jobId), results: await listScrapeResults(jobId) }));
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Résultats indisponibles." onRetry={data.reload} />;
  const { job, results } = data.data;
  if (!job) return <EmptyState message="Job introuvable." />;

  const duplicates = results.filter((r) => r.duplicateOf).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Résultats : ${SOURCE_LABELS[job.source]}`}
        description={`${results.length} résultat(s), dont ${duplicates} doublon(s) détecté(s).`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => exportCsv(results)}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
            <Button variant="outline" onClick={() => toast.info("Export Excel disponible dans la version finale")}><Download className="h-4 w-4" aria-hidden /> Excel</Button>
            <Button
              variant="accent"
              disabled={selected.length === 0 || importing}
              onClick={async () => {
                setImporting(true);
                const { imported, skipped } = await importScrapeResults(selected);
                setImporting(false);
                toast.success(`${imported} prospect(s) importé(s) dans le CRM${skipped ? ` — ${skipped} ignoré(s) (doublons ou déjà importés)` : ""}`);
                setSelected([]);
                data.reload();
              }}
            >
              Importer dans le CRM{selected.length > 0 && ` (${selected.length})`}
            </Button>
          </div>
        }
      />
      <Link href="/admin/scraper" className="text-sm underline">← Retour au scraper</Link>
      <ComplianceNote />
      <DataTable
        // key : réinitialise la sélection interne après un import
        key={results.filter((r) => r.importedToCrm).length}
        data={results}
        columns={columns}
        getRowId={(r) => r.id}
        selectable
        onSelectionChange={setSelected}
        pageSize={15}
        caption="Résultats du job de scraping"
        emptyMessage="Ce job n'a retourné aucun résultat."
      />
    </div>
  );
}
