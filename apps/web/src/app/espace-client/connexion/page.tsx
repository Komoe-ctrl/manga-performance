import { ReportPreview } from "@/components/layout/report-preview";
import { AuthShell } from "@/components/layout/auth-shell";
import { ClientLoginForm } from "@/components/client/login-form";

export default function Page() {
  return (
    <AuthShell
      badge="Espace client"
      headline="Vos rapports de gestion, au même endroit, à jour."
      preview={<ReportPreview />}
      title="Bienvenue dans votre espace"
      subtitle="Connectez-vous pour consulter vos livrables et écrire à votre consultant."
    >
      <ClientLoginForm />
    </AuthShell>
  );
}
