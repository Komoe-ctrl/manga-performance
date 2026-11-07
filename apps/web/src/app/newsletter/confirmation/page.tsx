import { Suspense } from "react";
import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { NewsletterStatus } from "@/components/layout/newsletter-status";

export const metadata: Metadata = { title: "Newsletter", robots: { index: false } };

export default function Page() {
  return (
    <AuthShell
      badge="Newsletter"
      headline="Merci de votre confiance."
      points={[{ icon: <Mail className="h-5 w-5" />, text: "Un email utile, de temps en temps" }]}
      title="Votre inscription"
      subtitle="Confirmation de votre adresse."
    >
      <Suspense>
        <NewsletterStatus />
      </Suspense>
    </AuthShell>
  );
}
