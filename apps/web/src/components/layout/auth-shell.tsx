import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Habillage commun des pages de connexion : panneau de marque à gauche, formulaire à droite. */
export function AuthShell({
  badge,
  headline,
  points,
  title,
  subtitle,
  children,
}: {
  badge: string;
  headline: string;
  points: { icon: React.ReactNode; text: string }[];
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="hero-grid absolute inset-0" aria-hidden="true" />
        <div className="orb absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-accent/30 blur-3xl" aria-hidden="true" />
        <Link href="/" className="relative font-heading text-xl font-extrabold">
          MANGA <span className="rounded bg-accent px-1.5 text-accent-foreground">PERFORMANCE</span>
        </Link>
        <div className="relative">
          <p className="rise mb-3 inline-block rounded-full border border-white/25 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-accent">{badge}</p>
          <h2 className="rise text-4xl font-extrabold leading-tight" style={{ "--i": 1 } as React.CSSProperties}>{headline}</h2>
          <ul className="mt-8 space-y-4">
            {points.map((p, i) => (
              <li key={i} className="rise flex items-center gap-3 text-slate-200" style={{ "--i": i + 2 } as React.CSSProperties}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-accent">{p.icon}</span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-400">Maquette : données fictives, authentification simulée.</p>
      </aside>

      <main id="contenu" tabIndex={-1} className="flex flex-col justify-center bg-muted/40 px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Retour au site
          </Link>
          <div className="rise rounded-2xl border border-border bg-background p-8 shadow-xl shadow-primary/5">
            <h1 className="text-2xl font-bold text-primary">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
