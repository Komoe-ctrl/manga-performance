"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const DEMO_EMAIL = "consultant@manga-performance.example";

/** Connexion simulée du consultant : tout mot de passe non vide est accepté. */
export function AdminLogin() {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!email.trim() || !password) return setError("Renseignez votre email et votre mot de passe.");
        signIn({ role: "consultant" });
        router.push("/admin");
      }}
    >
      <Field label="Email" htmlFor="admin-email">
        <div className="relative">
          <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input id="admin-email" type="email" autoComplete="username" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </Field>
      <Field label="Mot de passe" htmlFor="admin-password">
        <div className="relative">
          <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input id="admin-password" type="password" autoComplete="current-password" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="w-full">Se connecter</Button>
      <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        Maquette : identifiants de démonstration pré-remplis, cliquez simplement sur « Se connecter ».
      </p>
    </form>
  );
}
