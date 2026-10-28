import { PageHeader } from "@/components/shared";
import { ClientsView } from "@/components/crm/clients-view";

export default function Page() {
  return (
    <>
      <PageHeader title="Clients" description="Accès à l'espace client et publication de livrables." />
      <ClientsView />
    </>
  );
}
