import { PageHeader } from "@/components/shared";
import { InvoiceForm } from "@/components/billing/invoice-form";

export default function Page() {
  return (
    <>
      <PageHeader title="Nouvelle facture" />
      <InvoiceForm />
    </>
  );
}
