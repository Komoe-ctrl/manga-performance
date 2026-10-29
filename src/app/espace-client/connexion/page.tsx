import { FileText, MessageSquare, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { ClientLoginForm } from "@/components/client/login-form";

export default function Page() {
  return (
    <AuthShell
      badge="Espace client"
      headline="Retrouvez vos livrables et échangez avec votre consultant."
      points={[
        { icon: <FileText className="h-5 w-5" />, text: "Vos livrables PDF et Excel, toujours à jour" },
        { icon: <MessageSquare className="h-5 w-5" />, text: "Une messagerie directe avec le consultant" },
        { icon: <ShieldCheck className="h-5 w-5" />, text: "Un accès sécurisé et confidentiel" },
      ]}
      title="Connexion à votre espace"
      subtitle="Entrez vos identifiants pour consulter vos livrables."
    >
      <ClientLoginForm />
    </AuthShell>
  );
}
