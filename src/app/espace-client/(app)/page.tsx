import { PageHeader } from "@/components/shared";
import { DeliverablesView } from "@/components/client/deliverables-view";

export default function Page() {
  return (
    <>
      <PageHeader title="Mes livrables" description="Documents publiés par votre consultant." />
      <DeliverablesView />
    </>
  );
}
