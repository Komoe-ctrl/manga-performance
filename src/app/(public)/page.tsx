import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BlogList } from "@/components/public/blog";
import { NewsletterForm } from "@/components/public/newsletter-form";
import { Section } from "@/components/public/section";
import { contactInfo, socialLinks, keyFigures, references, services, testimonials } from "@/lib/content/site";

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
  email: contactInfo.email,
  sameAs: socialLinks.map((l) => l.href),
  areaServed: "Côte d'Ivoire",
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 md:grid-cols-[1.4fr_1fr]">
          <div>
            <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">
              Vos coûts vous échappent ? <span className="text-accent">Pilotez-les.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-slate-200">
              Audit, data et contrôle de gestion pour les PME et entreprises d&apos;Abidjan et de Côte d&apos;Ivoire.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/contact" className={buttonVariants({ variant: "accent", size: "lg" })}>
                Prendre rendez-vous
              </Link>
              <Link
                href="/demo"
                className={buttonVariants({ variant: "outline", size: "lg", className: "bg-transparent text-white hover:bg-white/10" })}
              >
                Voir une démo
              </Link>
            </div>
          </div>
          <div
            role="img"
            aria-label="Photo du consultant (à fournir)"
            className="flex aspect-square items-center justify-center rounded-xl bg-white/10 text-sm text-slate-300"
          >
            Photo du consultant
          </div>
        </div>
      </div>

      <Section title="Nos services">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((s) => (
            <Link key={s.slug} href={`/services/${s.slug}`} className="rounded-lg border border-border p-4 hover:border-accent">
              <h3 className="font-bold text-primary">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.short}</p>
              <span className="mt-3 inline-block text-sm font-medium underline">En savoir plus</span>
            </Link>
          ))}
        </div>
      </Section>

      <Section tone="muted">
        <dl className="grid grid-cols-2 gap-6 text-center md:grid-cols-4">
          {keyFigures.map((f) => (
            <div key={f.label}>
              <dd className="text-4xl font-extrabold text-primary">{f.value}</dd>
              <dt className="mt-1 text-sm text-muted-foreground">{f.label}</dt>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Références et témoignages">
        <div className="grid gap-4 md:grid-cols-3">
          {references.slice(0, 2).map((r) => (
            <div key={r.sector} className="rounded-lg border border-border p-4">
              <p className="text-xs font-medium text-warning">{r.sector}</p>
              <p className="mt-2 text-sm text-muted-foreground">{r.result}</p>
            </div>
          ))}
          {testimonials.slice(0, 1).map((t) => (
            <blockquote key={t.author} className="rounded-lg bg-muted p-4 text-sm">
              <p>{t.quote}</p>
              <footer className="mt-2 text-xs text-muted-foreground">— {t.author}</footer>
            </blockquote>
          ))}
        </div>
        <Link href="/references" className="mt-4 inline-block text-sm font-medium underline">
          Toutes les références
        </Link>
      </Section>

      <Section title="Derniers articles" tone="muted">
        <BlogList limit={3} />
      </Section>

      <Section title="Restez informé" intro="Recevez nos conseils de pilotage et de gestion, sans spam.">
        <NewsletterForm />
      </Section>
    </>
  );
}
