"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { listScrapeJobs } from "@/lib/services";

export default function Page() {
  return (
    <>
      <PageHeader title="Scraper" description="Écran détaillé prévu à l'étape 8." />
      <MockOverview loader={listScrapeJobs} label="jobs" render={(j) => `${j.id} — ${j.source} — ${j.resultsCount} résultats`} />
    </>
  );
}
