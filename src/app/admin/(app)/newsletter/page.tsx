"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { listSubscribers } from "@/lib/services";

export default function Page() {
  return (
    <>
      <PageHeader title="Newsletter" description="Écran détaillé prévu à l'étape 7." />
      <MockOverview loader={listSubscribers} label="abonnés" render={(s) => s.email} />
    </>
  );
}
