import { PageHeader } from "@/components/shared";
import { ClientCollection } from "@/components/collection/client-collection";

export default function Page() {
  return (
    <>
      <PageHeader title="Collecte" description="Déposez vos fichiers mensuels et suivez leur contrôle." />
      <ClientCollection />
    </>
  );
}
