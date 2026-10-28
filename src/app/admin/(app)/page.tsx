"use client";

import { KpiCard, PageHeader } from "@/components/shared";
import { useAsync } from "@/lib/hooks/use-async";
import { listInvoices, listProspects, listScrapeJobs } from "@/lib/services";

export default function Page() {
  const data = useAsync(async () => ({
    prospects: await listProspects(),
    invoices: await listInvoices(),
    jobs: await listScrapeJobs(),
  }));
  const v = (n: number | undefined) => (data.status === "success" ? String(n) : "…");
  return (
    <>
      <PageHeader title="Tableau de bord" description="KPI et graphiques prévus à l'étape 4." />
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Prospects (fixtures)" value={v(data.status === "success" ? data.data.prospects.length : undefined)} />
        <KpiCard label="Factures (fixtures)" value={v(data.status === "success" ? data.data.invoices.length : undefined)} />
        <KpiCard label="Jobs de scraping" value={v(data.status === "success" ? data.data.jobs.length : undefined)} />
      </div>
    </>
  );
}
