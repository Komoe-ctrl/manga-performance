import { PageHeader } from "@/components/shared";
import { NewsletterAdmin } from "@/components/marketing/newsletter-admin";

export default function Page() {
  return (
    <>
      <PageHeader title="Newsletter" description="Abonnés avec double opt-in." />
      <NewsletterAdmin />
    </>
  );
}
