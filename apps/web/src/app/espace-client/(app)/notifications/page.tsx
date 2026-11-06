import { PageHeader } from "@/components/shared";
import { NotificationsView } from "@/components/client/notifications-view";

export default function Page() {
  return (
    <>
      <PageHeader title="Notifications" />
      <NotificationsView />
    </>
  );
}
