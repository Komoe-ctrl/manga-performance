"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { listFollowUps } from "@/lib/services";

export default function Page() {
  return (
    <>
      <PageHeader title="Relances" description="Écran détaillé prévu à l'étape 4." />
      <MockOverview loader={listFollowUps} label="relances" render={(f) => `${f.prospectId} — ${f.rule} — ${f.dueAt.slice(0, 10)}`} />
    </>
  );
}
