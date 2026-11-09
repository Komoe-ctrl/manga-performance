"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { USE_DB, signInAdmin, verifyTwoFactorCode } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Field, Input } from "@/components/ui/field";

const DEMO_EMAIL = "consultant@manga-performance.example";

/**
 * Connexion du consultant.
 * - `DATA_SOURCE=mock` : simulée, tout mot de passe non vide est accepté.
 * - `DATA_SOURCE=db` : Better Auth, puis code de l'application d'authentification (2FA obligatoire).
 */
export function AdminLogin() {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState(USE_DB ? "" : DEMO_EMAIL);
  const [password, setPassword] = useState(USE_DB ? "" : "demo1234");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const finish = () => {
    signIn({ role: "consultant" });
    router.push("/admin");
  };

  async function submitPassword() {
    if (!email.trim() || !password) return setError("Renseignez votre email et votre mot de passe.");
    setPending(true);
    const result = await signInAdmin(email, password);
    setPending(false);
    switch (result.status) {
      case "ok":
        return finish();
      case "two_factor":
        setStep("code");
        return;
      case "enroll":
        return router.push("/admin/securite");
      case "error":
        return setError(result.message);
    }
  }

  async function submitCode() {
    if (!/^\d{6}$/.test(code.trim())) return setError("Saisissez le code à 6 chiffres.");
    setPending(true);
    const result = await verifyTwoFactorCode(code);
    setPending(false);
    if (!result.ok) return setError(result.message);
    finish();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        void (step === "password" ? submitPassword() : submitCode());
      }}
    >
      {step === "password" ? (
        <>
          <Field label="Email" htmlFor="admin-email">
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input id="admin-email" type="email" autoComplete="username" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </Field>
          <Field label="Mot de passe" htmlFor="admin-password">
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
              <PasswordInput id="admin-password" autoComplete="current-password" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </Field>
        </>
      ) : (
        <Field label="Code de l'application d'authentification" htmlFor="admin-code">
          <div className="relative">
            <ShieldCheck className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              id="admin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              className="pl-9 tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        </Field>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {step === "password" ? "Se connecter" : "Valider le code"}
      </Button>
      {!USE_DB && (
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          Maquette : identifiants de démonstration pré-remplis, cliquez simplement sur « Se connecter ».
        </p>
      )}
    </form>
  );
}
