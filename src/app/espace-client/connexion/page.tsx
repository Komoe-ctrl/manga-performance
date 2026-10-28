import { PageHeader } from "@/components/shared";
import { ClientLoginForm } from "@/components/client/login-form";
import { ProfilePicker } from "@/components/layout/profile-picker";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-md p-6">
      <PageHeader title="Espace client" description="Connectez-vous pour consulter vos livrables." />
      <ClientLoginForm />
      <div className="my-6 border-t border-border pt-4">
        <p className="mb-2 text-sm font-medium">Maquette : se connecter en tant que…</p>
        <ProfilePicker space="client" />
      </div>
    </div>
  );
}
