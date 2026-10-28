"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { listClients } from "@/lib/services";

export default function Page() {
  return (
    <>
      <PageHeader title="Clients" description="Écran détaillé prévu à l'étape 4." />
      <MockOverview loader={listClients} label="clients" render={(c) => `${c.companyName} — ${c.deliverablesCount} livrable(s)`} />
    </>
  );
}
