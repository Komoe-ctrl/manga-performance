import { PageHeader } from "@/components/shared";
import { ProfilePicker } from "@/components/layout/profile-picker";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-md p-6">
      <PageHeader title="Connexion back-office" description="Authentification simulée : choisissez un profil." />
      <ProfilePicker space="admin" />
    </div>
  );
}
