"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { listProspects } from "@/lib/services";

export default function Page() {
  return (
    <>
      <PageHeader title="Prospects" description="Écran détaillé prévu à l'étape 4." />
      <MockOverview loader={listProspects} label="prospects" render={(p) => `${p.companyName} — ${p.city} — ${p.status}`} />
    </>
  );
}
