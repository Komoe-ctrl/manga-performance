import { PageHeader } from "@/components/shared";
import { FollowUpsView } from "@/components/crm/follow-ups-view";

export default function Page() {
  return (
    <>
      <PageHeader title="Relances" description="En retard, aujourd'hui et à venir." />
      <FollowUpsView />
    </>
  );
}
