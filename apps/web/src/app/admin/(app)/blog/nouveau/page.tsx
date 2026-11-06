import { PageHeader } from "@/components/shared";
import { NewPostEditor } from "@/components/marketing/blog-editor";

export default function Page() {
  return (
    <>
      <PageHeader title="Nouvel article" />
      <NewPostEditor />
    </>
  );
}
