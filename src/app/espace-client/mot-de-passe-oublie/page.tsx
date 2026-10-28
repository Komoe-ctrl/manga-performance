"use client";

import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-md p-6">
      <PageHeader title="Mot de passe oublié" description="Écran de démonstration : aucun email n'est envoyé." />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          toast.info("Disponible dans la version finale");
        }}
      >
        <Field label="Email" htmlFor="forgot-email">
          <Input id="forgot-email" type="email" required />
        </Field>
        <Button type="submit" className="w-full">Envoyer le lien</Button>
      </form>
      <p className="mt-4 text-center text-sm"><Link href="/espace-client/connexion" className="underline">Retour à la connexion</Link></p>
    </div>
  );
}
