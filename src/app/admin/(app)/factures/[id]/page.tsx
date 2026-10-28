import { Suspense } from "react";
import { LoadingState } from "@/components/shared";
import { InvoiceDetail } from "@/components/billing/invoice-detail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <InvoiceDetail params={params} />
    </Suspense>
  );
}
