"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { USE_DB, requestPasswordReset } from "@/lib/services";

export default function Page() {
  const [pending, setPending] = useState(false);

  return (
    <div className="mx-auto w-full max-w-md p-6">
      <PageHeader
        title="Mot de passe oublié"
        description={USE_DB ? "Nous vous enverrons un lien valable une heure." : "Écran de démonstration : aucun email n'est envoyé."}
      />
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!USE_DB) return toast.info("Disponible dans la version finale");
          const email = String(new FormData(e.currentTarget).get("email") ?? "");
          setPending(true);
          await requestPasswordReset(email);
          setPending(false);
          // Same message whether or not the address is known.
          toast.success("Si un compte existe pour cette adresse, un email vient d'être envoyé.");
        }}
      >
        <Field label="Email" htmlFor="forgot-email">
          <Input id="forgot-email" name="email" type="email" required />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>Envoyer le lien</Button>
      </form>
      <p className="mt-4 text-center text-sm"><Link href="/espace-client/connexion" className="underline">Retour à la connexion</Link></p>
    </div>
  );
}
