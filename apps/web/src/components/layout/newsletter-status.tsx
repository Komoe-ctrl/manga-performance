"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";

const MESSAGES: Record<string, string> = {
  confirmed: "Votre inscription est confirmée. Merci !",
  expired: "Ce lien a expiré (il est valable 48 heures). Inscrivez-vous à nouveau depuis le site pour recevoir un nouveau lien.",
  invalid: "Ce lien est invalide ou a déjà été utilisé. Si vous êtes déjà inscrit, vous n'avez rien à faire.",
};

/** Result of a click on the confirmation link. */
export function NewsletterStatus() {
  const status = useSearchParams().get("status") ?? "invalid";
  return (
    <div className="space-y-4" role="status">
      <p className="text-sm">{MESSAGES[status] ?? MESSAGES.invalid}</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>Retour au site</Link>
    </div>
  );
}
