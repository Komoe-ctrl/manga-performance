"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { listInvoices } from "@/lib/services";

export default function Page() {
  return (
    <>
      <PageHeader title="Facturation" description="Écran détaillé prévu à l'étape 5." />
      <MockOverview loader={listInvoices} label="factures" render={(i) => `${i.number} — ${i.status}`} />
    </>
  );
}
