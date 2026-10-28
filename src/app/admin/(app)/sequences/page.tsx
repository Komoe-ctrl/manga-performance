import { PageHeader } from "@/components/shared";
import { SequencesList } from "@/components/marketing/sequences";

export default function Page() {
  return (
    <>
      <PageHeader title="Séquences email" description="Automatisations d'emails et statistiques." />
      <SequencesList />
    </>
  );
}
