import { Suspense } from "react";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { SetPasswordForm } from "@/components/layout/set-password-form";

export const metadata: Metadata = { title: "Activer votre accès", robots: { index: false } };

export default function Page() {
  return (
    <AuthShell
      badge="Compte"
      headline="Un accès simple et sécurisé."
      points={[{ icon: <Lock className="h-5 w-5" />, text: "Lien à usage unique" }]}
      title="Activer votre accès"
      subtitle="Choisissez le mot de passe de votre compte."
    >
      <Suspense>
        <SetPasswordForm mode="invitation" />
      </Suspense>
    </AuthShell>
  );
}
