import { Suspense } from "react";
import { LoadingState, PageHeader } from "@/components/shared";
import { EditPostEditor } from "@/components/marketing/blog-editor";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <PageHeader title="Éditer l'article" />
      <Suspense fallback={<LoadingState />}>
        <EditPostEditor params={params} />
      </Suspense>
    </>
  );
}
