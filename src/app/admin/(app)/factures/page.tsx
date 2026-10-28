import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shared";
import { InvoicesList } from "@/components/billing/invoices-list";

export default function Page() {
  return (
    <>
      <PageHeader
        title="Facturation"
        description="Suivi des factures, encaissements et relances."
        actions={<Link href="/admin/factures/nouvelle" className={buttonVariants({ variant: "accent" })}>Nouvelle facture</Link>}
      />
      <InvoicesList />
    </>
  );
}
