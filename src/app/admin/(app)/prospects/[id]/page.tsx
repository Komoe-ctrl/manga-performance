import { Suspense } from "react";
import { LoadingState } from "@/components/shared";
import { ProspectDetail } from "@/components/crm/prospect-detail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <ProspectDetail params={params} />
    </Suspense>
  );
}
