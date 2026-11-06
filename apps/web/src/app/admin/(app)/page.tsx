import { PageHeader } from "@/components/shared";
import { AdminDashboard } from "@/components/crm/admin-dashboard";

export default function Page() {
  return (
    <>
      <PageHeader title="Tableau de bord" description="Vue d'ensemble de l'activité commerciale." />
      <AdminDashboard />
    </>
  );
}
