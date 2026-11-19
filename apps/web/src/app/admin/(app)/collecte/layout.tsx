import { PageHeader } from "@/components/shared";
import { CollectionTabs } from "@/components/collection/collection-tabs";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Collecte" description="Dépôts des clients : qui a déposé, ce qui est en retard, ce qui a été rejeté." />
      <CollectionTabs />
      {children}
    </>
  );
}
