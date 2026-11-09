import Link from "next/link";
import { ArrowRight, BookOpen, LineChart, Mail, Wrench } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

const SUGGESTIONS = [
  { href: "/services", label: "Nos services", hint: "Business plan, tableaux de bord, trésorerie", icon: Wrench },
  { href: "/demo", label: "La démo", hint: "Un tableau de bord d'exemple à explorer", icon: LineChart },
  { href: "/blog", label: "Le blog", hint: "Conseils de pilotage et de gestion", icon: BookOpen },
  { href: "/contact", label: "Nous écrire", hint: "Réponse sous 24 h ouvrées", icon: Mail },
];

export default function NotFound() {
  return (
    <main id="contenu" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 p-6">
      <div className="text-center">
        <Link href="/" className="font-heading text-xl font-extrabold text-primary">
          MANGA <span className="rounded bg-accent px-1.5 text-accent-foreground">PERFORMANCE</span>
        </Link>
        <p className="mt-10 text-sm font-semibold uppercase tracking-widest text-warning">Erreur 404</p>
        <h1 className="mt-2 text-4xl font-extrabold text-primary">Cette page est introuvable</h1>
        <p className="mt-3 text-muted-foreground">Le lien est peut-être ancien, ou l&apos;adresse mal saisie. Voici où continuer.</p>
        <Link href="/" className={buttonVariants({ variant: "accent", className: "mt-6" })}>Retour à l&apos;accueil</Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map(({ href, label, hint, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="card-lift group flex items-center gap-3 rounded-xl border border-border p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-primary">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
