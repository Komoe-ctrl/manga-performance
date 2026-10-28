import { Suspense } from "react";
import { LoadingState, PageHeader } from "@/components/shared";
import { SequenceEditor } from "@/components/marketing/sequences";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <PageHeader title="Éditeur de séquence" />
      <Suspense fallback={<LoadingState />}>
        <SequenceEditor params={params} />
      </Suspense>
    </>
  );
}
