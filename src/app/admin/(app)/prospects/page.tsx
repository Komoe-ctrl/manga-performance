import { PageHeader } from "@/components/shared";
import { ProspectsView } from "@/components/crm/prospects-view";

export default function Page() {
  return (
    <>
      <PageHeader title="Prospects" description="Segmentation, kanban et création de prospects." />
      <ProspectsView />
    </>
  );
}
