import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Lock, Mail, Phone } from "lucide-react";
import { contactInfo } from "@/lib/content/site";
import { consultant } from "@/lib/content/profile";

/**
 * Habillage commun des pages de connexion : panneau de marque à gauche (avec un aperçu de
 * livrable ou une liste d'atouts), formulaire à droite, coordonnées du consultant en bas.
 */
export function AuthShell({
  badge,
  headline,
  points,
  preview,
  title,
  subtitle,
  children,
}: {
  badge: string;
  headline: string;
  points?: { icon: React.ReactNode; text: string }[];
  /** Illustration affichée à la place de la liste d'atouts. */
  preview?: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="hero-grid absolute inset-0" aria-hidden="true" />
        <div className="orb absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-accent/30 blur-3xl" aria-hidden="true" />
        <Link href="/" className="relative font-heading text-xl font-extrabold">
          MANGA <span className="rounded bg-accent px-1.5 text-accent-foreground">PERFORMANCE</span>
        </Link>

        <div className="relative">
          <p className="rise mb-3 inline-block rounded-full border border-white/25 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-accent">{badge}</p>
          <h2 className="rise max-w-lg text-4xl font-extrabold leading-tight" style={{ "--i": 1 } as React.CSSProperties}>{headline}</h2>
          {preview ? (
            <div className="rise" style={{ "--i": 2 } as React.CSSProperties}>{preview}</div>
          ) : (
            <ul className="mt-8 space-y-4">
              {points?.map((p, i) => (
                <li key={i} className="rise flex items-center gap-3 text-slate-200" style={{ "--i": i + 2 } as React.CSSProperties}>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-accent">{p.icon}</span>
                  {p.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="relative flex items-center gap-4 border-t border-white/15 pt-6">
          <Image src={consultant.photo} alt="" width={48} height={48} className="h-12 w-12 rounded-full object-cover ring-2 ring-accent/70" />
          <div className="text-sm">
            <p className="font-semibold">{consultant.name}</p>
            <p className="text-slate-300">Votre consultant · une question, un accès perdu ?</p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-200">
              <a href={`tel:${contactInfo.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 hover:text-accent"><Phone className="h-3 w-3" aria-hidden /> {contactInfo.phone}</a>
              <a href={`mailto:${contactInfo.email}`} className="inline-flex items-center gap-1 hover:text-accent"><Mail className="h-3 w-3" aria-hidden /> {contactInfo.email}</a>
            </p>
          </div>
        </div>
      </aside>

      <main id="contenu" tabIndex={-1} className="relative flex flex-col justify-center overflow-hidden bg-muted/40 px-6 py-10 sm:px-12">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-md">
          <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Retour au site
          </Link>
          <div className="rise overflow-hidden rounded-2xl border border-border bg-background shadow-xl shadow-primary/5">
            <div className="h-1 bg-gradient-to-r from-accent via-accent/60 to-primary" aria-hidden />
            <div className="p-8">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-accent" aria-hidden>
                <Lock className="h-5 w-5" />
              </span>
              <h1 className="text-2xl font-bold text-primary">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
              <div className="mt-6">{children}</div>
            </div>
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden /> Connexion chiffrée · accès réservé aux clients de MANGA PERFORMANCE
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            <Link href="/confidentialite" className="underline hover:text-primary">Confidentialité</Link>
            {" · "}
            <Link href="/mentions-legales" className="underline hover:text-primary">Mentions légales</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
