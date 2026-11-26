import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { LatestPosts } from "@/components/public/blog";
import { NewsletterForm } from "@/components/public/newsletter-form";
import { Marquee, HeroVisual } from "@/components/public/motion";
import { Typewriter } from "@/components/public/motion-client";
import { MoreLabel } from "@/components/shared/more-link";
import { KeyFigures } from "@/components/public/key-figures";
import { TrustedBySection } from "@/components/public/references";
import { Section } from "@/components/public/section";
import { AboutTeaser, Formulas, ProblemChips } from "@/components/public/profile-sections";
import { consultant, sectors } from "@/lib/content/profile";
import { contactInfo, socialLinks, services } from "@/lib/content/site";

export const metadata: Metadata = {
  title: "Audit, Data et Contrôle de Gestion à Abidjan",
  description:
    "Cabinet de conseil indépendant à Abidjan : business plan bancable, tableaux de bord KPI, trésorerie et maîtrise des coûts.",
  openGraph: { title: "MANGA PERFORMANCE", description: "Vos coûts vous échappent ? Pilotez-les.", type: "website", locale: "fr_FR" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  name: "MANGA PERFORMANCE",
  description: "Cabinet de conseil en Audit, Data et Contrôle de Gestion",
  address: { "@type": "PostalAddress", addressLocality: "Abidjan", addressCountry: "CI" },
  telephone: contactInfo.phone,
  image: "/images/consultant.jpg",
  logo: "/images/logo.png",
  founder: { "@type": "Person", name: consultant.name, jobTitle: consultant.role },
  openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], opens: "08:00", closes: "18:00" }],
  email: contactInfo.email,
  sameAs: socialLinks.map((l) => l.href),
  areaServed: "Côte d'Ivoire",
};

const HERO_WORDS = ["Audit.", "Data Analytique.", "Contrôle de gestion."];
const SECTOR_ITEMS = sectors;
const SKILL_ITEMS = ["Business plan bancable", "Tableaux de bord KPI", "Trésorerie", "Maîtrise des coûts", "Audit", "Data"];

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="hero-grid absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="rise text-sm font-semibold uppercase tracking-widest text-accent">
              Cabinet de conseil · <Typewriter phrases={HERO_WORDS} />
            </p>
            <h1 className="rise mt-4 text-4xl font-extrabold leading-tight md:text-6xl" style={{ "--i": 1 } as React.CSSProperties}>
              Vos coûts vous échappent&nbsp;? <span className="bg-gradient-to-r from-accent to-amber-200 bg-clip-text text-transparent">Pilotez-les.</span>
            </h1>
            <p className="rise mt-5 max-w-xl text-lg text-slate-200" style={{ "--i": 2 } as React.CSSProperties}>
              Audit, data et contrôle de gestion pour les PME et entreprises d&apos;Abidjan et de Côte d&apos;Ivoire.
            </p>
            <div className="rise mt-8 flex flex-wrap gap-3" style={{ "--i": 3 } as React.CSSProperties}>
              <Link href="/contact" className={buttonVariants({ variant: "accent", size: "lg", className: "btn-shine pulse-ring" })}>
                Prendre rendez-vous
              </Link>
              <Link
                href="/demo"
                className={buttonVariants({ variant: "outlineLight", size: "lg" })}
              >
                Voir une démo
              </Link>
            </div>
          </div>
          <div className="rise" style={{ "--i": 2 } as React.CSSProperties}>
            <HeroVisual />
          </div>
        </div>
      </div>

      <div className="border-y border-white/10 bg-[#111d35] py-4 text-sm font-semibold uppercase tracking-wider text-white" aria-label="Secteurs accompagnés">
        <Marquee items={SECTOR_ITEMS} />
      </div>

      <ProblemChips />

      <Section title="Nos services">
        <div className="reveal grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((s, i) => (
            <Link key={s.slug} href={`/services/${s.slug}`} className="card-lift group flex flex-col rounded-xl border border-border bg-background p-5">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{i + 1}</span>
              <h3 className="font-bold text-primary">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.short}</p>
              <span className="mt-auto inline-block pt-4"><MoreLabel>En savoir plus</MoreLabel></span>
            </Link>
          ))}
        </div>
      </Section>

      <div className="bg-accent py-5 text-lg font-bold uppercase tracking-wide text-accent-foreground" aria-hidden="true">
        <Marquee items={SKILL_ITEMS} reverse />
      </div>

      <AboutTeaser />

      <Formulas />

      <KeyFigures />

      <TrustedBySection />

      <LatestPosts />

      <Section title="Restez informé" intro="Recevez nos conseils de pilotage et de gestion, sans spam.">
        <div className="reveal">
          <NewsletterForm />
        </div>
      </Section>
    </>
  );
}
