import { BarChart3, Receipt, Users } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { AdminLogin } from "@/components/layout/admin-login";

export default function Page() {
  return (
    <AuthShell
      badge="Back-office"
      headline="Pilotez votre activité commerciale en un seul endroit."
      points={[
        { icon: <Users className="h-5 w-5" />, text: "Prospects, relances et clients" },
        { icon: <Receipt className="h-5 w-5" />, text: "Facturation et suivi des encaissements" },
        { icon: <BarChart3 className="h-5 w-5" />, text: "Tableaux de bord et marketing" },
      ]}
      title="Connexion au back-office"
      subtitle="Espace réservé au consultant."
    >
      <AdminLogin />
    </AuthShell>
  );
}
