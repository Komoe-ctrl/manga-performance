import type { Metadata } from "next";
import { Section } from "@/components/public/section";
import { ConsultantPhoto, Formulas, KeyMissions, ProblemChips, SectorChips } from "@/components/public/profile-sections";
import { buttonVariants } from "@/components/ui/button";
import { contactInfo } from "@/lib/content/site";
import { consultant, tagline } from "@/lib/content/profile";
import Link from "next/link";

export const metadata: Metadata = {
  title: "À propos",
  description: `${consultant.name}, consultant indépendant en audit, data analytique et contrôle de gestion à Abidjan. MBA Audit & Contrôle de Gestion, plus de 10 ans d'expérience.`,
  openGraph: { title: "À propos | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <div className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="hero-grid absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-[auto_1fr]">
          <div className="rise">
            <ConsultantPhoto className="mx-auto h-56 w-56 md:h-72 md:w-72" priority />
          </div>
          <div>
            <p className="rise text-sm font-semibold uppercase tracking-widest text-accent">Consultant</p>
            <h1 className="rise mt-2 text-4xl font-extrabold md:text-5xl" style={{ "--i": 1 } as React.CSSProperties}>{consultant.name}</h1>
            <p className="rise mt-2 text-slate-300" style={{ "--i": 2 } as React.CSSProperties}>Audit · Data Analytique · Contrôle de Gestion</p>
            <p className="rise mt-5 max-w-2xl text-lg text-slate-200" style={{ "--i": 3 } as React.CSSProperties}>{consultant.bio}</p>
            <blockquote className="rise mt-5 max-w-2xl border-l-4 border-accent pl-4 italic text-accent" style={{ "--i": 4 } as React.CSSProperties}>
              « {consultant.quote} »
            </blockquote>
          </div>
        </div>
      </div>

      <Section title="Parcours et diplômes">
        <ul className="reveal grid gap-4 sm:grid-cols-2">
          <li className="card-lift rounded-xl border border-border p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-warning">Diplôme</p>
            <p className="mt-1 font-bold text-primary">MBA Audit &amp; Contrôle de Gestion</p>
          </li>
          <li className="card-lift rounded-xl border border-border p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-warning">Expérience</p>
            <p className="mt-1 font-bold text-primary">Plus de 10 ans en audit, data et contrôle de gestion</p>
          </li>
        </ul>
      </Section>

      <ProblemChips />

      <Section title="Mes missions clés" tone="muted">
        <div className="reveal"><KeyMissions /></div>
      </Section>

      <Section title="Secteurs d'intervention">
        <div className="reveal"><SectorChips /></div>
      </Section>

      <Formulas tone="muted" />

      <Section title="Ma façon de travailler">
        <ol className="reveal grid gap-4 md:grid-cols-3">
          {[
            ["Comprendre", "Cadrer votre activité, vos chiffres et vos enjeux."],
            ["Mesurer", "Mettre en place des indicateurs fiables et utiles."],
            ["Piloter", "Transmettre les outils et accompagner leur usage."],
          ].map(([t, d], i) => (
            <li key={t} className="card-lift rounded-xl border border-border p-5">
              <p className="text-sm font-semibold text-warning">Étape {i + 1}</p>
              <h3 className="font-bold text-primary">{t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <div className="reveal rounded-2xl bg-primary p-8 text-center text-primary-foreground">
          <p className="font-heading text-2xl font-bold">{tagline}</p>
          <p className="mt-2 text-slate-300">{contactInfo.phone} · {contactInfo.email}</p>
          <Link href="/contact" className={buttonVariants({ variant: "accent", size: "lg", className: "btn-shine mt-5" })}>
            Prendre rendez-vous
          </Link>
        </div>
      </Section>
    </>
  );
}
