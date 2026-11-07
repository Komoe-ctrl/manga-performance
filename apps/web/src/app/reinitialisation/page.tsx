import { Suspense } from "react";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { SetPasswordForm } from "@/components/layout/set-password-form";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false } };

export default function Page() {
  return (
    <AuthShell
      badge="Compte"
      headline="Un accès simple et sécurisé."
      points={[{ icon: <Lock className="h-5 w-5" />, text: "Lien à usage unique" }]}
      title="Nouveau mot de passe"
      subtitle="Choisissez un nouveau mot de passe."
    >
      <Suspense>
        <SetPasswordForm mode="reset" />
      </Suspense>
    </AuthShell>
  );
}
