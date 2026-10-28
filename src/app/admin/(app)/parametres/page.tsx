import { PageHeader } from "@/components/shared";
import { SettingsForm } from "@/components/settings/settings-form";

export default function Page() {
  return (
    <>
      <PageHeader title="Paramètres" description="Cabinet, relances, facturation et WhatsApp." />
      <SettingsForm />
    </>
  );
}
