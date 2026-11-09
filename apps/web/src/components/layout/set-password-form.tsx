"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { acceptInvitation, resetPassword } from "@/lib/services";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

/** Sets a password from a single-use link: first activation (invitation) or reset. */
export function SetPasswordForm({ mode }: { mode: "invitation" | "reset" }) {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (done) {
    return (
      <div className="space-y-4" role="status">
        <p className="text-sm">Votre mot de passe est enregistré. Vous pouvez maintenant vous connecter.</p>
        <div className="flex flex-col gap-2">
          <Link href="/espace-client/connexion" className={buttonVariants({ size: "lg" })}>Espace client</Link>
          <Link href="/admin/connexion" className={buttonVariants({ size: "lg", variant: "outline" })}>Back-office</Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (!token) return setError("Ce lien est invalide. Demandez-en un nouveau.");
        if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
        setPending(true);
        const result = await (mode === "invitation" ? acceptInvitation : resetPassword)(token, password);
        setPending(false);
        if (result.ok) setDone(true);
        else setError(result.error);
      }}
    >
      <Field label="Nouveau mot de passe" htmlFor="new-password">
        <PasswordInput id="new-password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirmer le mot de passe" htmlFor="confirm-password">
        <PasswordInput id="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">10 caractères minimum, pas de mot de passe courant.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending || !password}>Enregistrer le mot de passe</Button>
    </form>
  );
}
