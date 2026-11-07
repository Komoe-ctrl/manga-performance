import { PageHeader } from "@/components/shared";
import { MessagesView } from "@/components/client/messages-view";

export default function Page() {
  return (
    <>
      <PageHeader title="Messages" />
      <MessagesView />
    </>
  );
}
