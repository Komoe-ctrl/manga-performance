import { PageHeader } from "@/components/shared";
import { ProfilePicker } from "@/components/layout/profile-picker";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-md p-6">
      <PageHeader title="Connexion espace client" description="Authentification simulée : choisissez un client." />
      <ProfilePicker space="client" />
    </div>
  );
}
