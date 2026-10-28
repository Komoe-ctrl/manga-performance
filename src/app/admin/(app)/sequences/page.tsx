"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { listSequences } from "@/lib/services";

export default function Page() {
  return (
    <>
      <PageHeader title="Séquences email" description="Écran détaillé prévu à l'étape 7." />
      <MockOverview loader={listSequences} label="séquences" render={(s) => `${s.name} (${s.steps.length} étapes)`} />
    </>
  );
}
