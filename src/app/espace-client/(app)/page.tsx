"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { useSession } from "@/lib/auth/session";
import { listDeliverables } from "@/lib/services";

export default function Page() {
  const { session } = useSession();
  const clientId = session?.role === "client" ? session.clientId : "";
  return (
    <>
      <PageHeader title="Mes livrables" description="Écran détaillé prévu à l'étape 6." />
      <MockOverview
        loader={() => listDeliverables(clientId)}
        label="livrables"
        render={(d) => `${d.title} (${d.fileType.toUpperCase()}, ${d.sizeKb} Ko)`}
      />
    </>
  );
}
