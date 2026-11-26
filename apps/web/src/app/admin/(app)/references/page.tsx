import { PageHeader } from "@/components/shared";
import { ReferencesAdmin } from "@/components/references/admin-references";

export default function Page() {
  return (
    <>
      <PageHeader title="Références" description="Les clients cités sur le site public et leurs témoignages, avec leurs autorisations." />
      <ReferencesAdmin />
    </>
  );
}
