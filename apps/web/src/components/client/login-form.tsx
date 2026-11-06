"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Lock, Mail, Search } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { useAsync } from "@/lib/hooks/use-async";
import { authenticateClient, listClients } from "@/lib/services";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const DEMO_PASSWORD = "demo1234";

/** Connexion simulée : email d'un client avec accès actif + mot de passe de 4 caractères minimum. */
export function ClientLoginForm() {
  const { signIn } = useSession();
  const router = useRouter();
  const clients = useAsync(listClients);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const matches = useMemo(() => {
    if (clients.status !== "success") return [];
    const q = query.trim().toLowerCase();
    return clients.data.filter((c) => !q || [c.companyName, c.contactName, c.sector, c.city].some((v) => v.toLowerCase().includes(q)));
  }, [clients, query]);

  return (
    <div className="space-y-6">
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!email.trim() || !password) return setError("Renseignez votre email et votre mot de passe.");
          setPending(true);
          const res = await authenticateClient(email, password);
          setPending(false);
          if (!res.ok) return setError(res.reason);
          signIn({ role: "client", clientId: res.clientId });
          router.push("/espace-client");
        }}
      >
        <Field label="Email" htmlFor="login-email">
          <div className="relative">
            <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input id="login-email" type="email" autoComplete="username" className="pl-9" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </Field>
        <Field label="Mot de passe" htmlFor="login-password">
          <div className="relative">
            <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input id="login-password" type="password" autoComplete="current-password" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>Se connecter</Button>
        <p className="text-center text-sm">
          <Link href="/espace-client/mot-de-passe-oublie" className="text-muted-foreground underline hover:text-primary">Mot de passe oublié ?</Link>
        </p>
      </form>

      <section aria-labelledby="demo-title" className="rounded-xl border border-dashed border-border p-4">
        <h2 id="demo-title" className="text-sm font-semibold text-primary">Maquette : pré-remplir avec un client</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Tapez le nom d&apos;une entreprise, cliquez dessus : l&apos;email et le mot de passe de démonstration se remplissent.
        </p>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Rechercher une entreprise" placeholder="Rechercher une entreprise…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto" aria-live="polite">
          {clients.status === "loading" && <li className="p-2 text-xs text-muted-foreground">Chargement…</li>}
          {clients.status === "success" && matches.length === 0 && <li className="p-2 text-xs text-muted-foreground">Aucune entreprise trouvée.</li>}
          {matches.map((c) => {
            const selected = email === c.email;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!c.accessActive}
                  onClick={() => {
                    setEmail(c.email ?? "");
                    setPassword(DEMO_PASSWORD);
                    setError(null);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all hover:-translate-y-px hover:border-accent hover:bg-accent/10 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0",
                    selected ? "border-accent bg-accent/15" : "border-border",
                  )}
                >
                  <span>
                    <span className="block font-medium">{c.companyName}</span>
                    <span className="block text-xs text-muted-foreground">{c.contactName} · {c.sector}</span>
                  </span>
                  {selected ? <Check className="h-4 w-4 text-success" aria-hidden /> : !c.accessActive && <span className="text-xs text-muted-foreground">accès inactif</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
