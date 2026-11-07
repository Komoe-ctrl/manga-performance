import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { TwoFactorSetup } from "@/components/layout/two-factor-setup";

export const metadata: Metadata = { title: "Double authentification" };

export default function Page() {
  return (
    <AuthShell
      badge="Sécurité"
      headline="Protégez l'accès à vos données clients."
      points={[{ icon: <ShieldCheck className="h-5 w-5" />, text: "Double authentification obligatoire" }]}
      title="Activer la double authentification"
      subtitle="Une étape unique, puis un code à chaque connexion."
    >
      <TwoFactorSetup />
    </AuthShell>
  );
}
