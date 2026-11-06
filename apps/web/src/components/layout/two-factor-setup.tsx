"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { fetchCurrentUser } from "@/lib/auth/auth-client";
import { useSession } from "@/lib/auth/session";
import {
  confirmTwoFactorEnrolment,
  startTwoFactorEnrolment,
  type TwoFactorEnrolment,
} from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** Mandatory 2FA enrolment for the consultant (spec, section 5). */
export function TwoFactorSetup() {
  const router = useRouter();
  const { signIn } = useSession();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetchCurrentUser()
      .catch(() => null)
      .then((user) => {
        if (user?.role !== "ADMIN") router.replace("/admin/connexion");
        else if (user.twoFactorEnabled) router.replace("/admin");
        else setAllowed(true);
      });
  }, [router]);

  if (!allowed) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  if (!enrolment) {
    return (
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setPending(true);
          const result = await startTwoFactorEnrolment(password);
          setPending(false);
          if (result.ok) setEnrolment(result.enrolment);
          else setError(result.message);
        }}
      >
        <p className="text-sm text-muted-foreground">
          La double authentification est obligatoire pour accéder au back-office. Confirmez votre mot de passe pour commencer.
        </p>
        <Field label="Mot de passe" htmlFor="setup-password">
          <Input id="setup-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={pending || !password}>Continuer</Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setPending(true);
        const result = await confirmTwoFactorEnrolment(code);
        setPending(false);
        if (!result.ok) return setError(result.message);
        signIn({ role: "consultant" });
        router.push("/admin");
      }}
    >
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          Dans votre application d&apos;authentification (Google Authenticator, Microsoft Authenticator…), ajoutez un compte
          avec cette clé :
          <code className="mt-1 block break-all rounded bg-muted p-2 font-mono text-xs">{enrolment.secret}</code>
        </li>
        <li>
          Conservez ces codes de secours dans un endroit sûr (chacun ne sert qu&apos;une fois) :
          <code className="mt-1 grid grid-cols-2 gap-1 rounded bg-muted p-2 font-mono text-xs">
            {enrolment.backupCodes.map((c) => <span key={c}>{c}</span>)}
          </code>
        </li>
        <li>Saisissez le code à 6 chiffres affiché par l&apos;application.</li>
      </ol>
      <Field label="Code à 6 chiffres" htmlFor="setup-code">
        <div className="relative">
          <ShieldCheck className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input id="setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="pl-9 tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
      </Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending || code.trim().length !== 6}>
        <KeyRound className="mr-2 h-4 w-4" aria-hidden /> Activer la double authentification
      </Button>
    </form>
  );
}
