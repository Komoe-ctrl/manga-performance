"use client";

import { Quote } from "lucide-react";
import { useAsync } from "@/lib/hooks/use-async";
import { listPublicReferences, listPublicTestimonials } from "@/lib/services";
import type { PublicReference } from "@/lib/types/references";
import { MoreLink } from "@/components/shared/more-link";
import { Section } from "./section";

/**
 * Contenu alimenté par /admin/references. Tant que rien n'est publié (ou pendant le chargement, ou si la
 * lecture échoue), rien ne s'affiche : jamais de titre vide ni de texte provisoire visible du public.
 */

function Logo({ reference, className }: { reference: PublicReference; className?: string }) {
  return reference.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={reference.logoUrl} alt={reference.name} loading="lazy" className={className} />
  ) : (
    <span className="text-base font-bold text-primary">{reference.name}</span>
  );
}

function ExternalLink({ reference, children }: { reference: PublicReference; children: React.ReactNode }) {
  if (!reference.url) return <>{children}</>;
  return (
    <a href={reference.url} target="_blank" rel="noopener noreferrer" aria-label={`${reference.name} (nouvel onglet)`} className="block rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/40">
      {children}
    </a>
  );
}

/** Accueil : bloc « Ils nous font confiance » (logos), masqué s'il n'y a aucune référence publiée. */
export function TrustedBySection() {
  const references = useAsync(listPublicReferences);
  if (references.status !== "success" || references.data.length === 0) return null;
  return (
    <Section title="Ils nous font confiance">
      <ul className="reveal flex flex-wrap items-center gap-4">
        {references.data.map((r) => (
          <li key={r.id} className="card-lift flex h-20 min-w-40 items-center justify-center rounded-lg border border-border bg-background px-6">
            <ExternalLink reference={r}>
              <Logo reference={r} className="max-h-12 w-auto max-w-40 object-contain" />
            </ExternalLink>
          </li>
        ))}
      </ul>
      <MoreLink href="/references" className="mt-5">Toutes les références</MoreLink>
    </Section>
  );
}

/** Page /references : les références publiées. */
export function ReferencesGrid() {
  const references = useAsync(listPublicReferences);
  if (references.status !== "success") return null;
  if (references.data.length === 0) {
    return (
      <Section>
        <p className="max-w-xl text-muted-foreground">
          Vous voulez savoir comment nous accompagnons les entreprises de votre secteur ? <MoreLink href="/contact">Parlons de votre projet</MoreLink>
        </p>
      </Section>
    );
  }
  return (
    <Section title="Ils nous font confiance">
      <div className="grid gap-4 md:grid-cols-3">
        {references.data.map((r) => (
          <article key={r.id} className="card-lift flex flex-col rounded-xl border border-border bg-background p-4">
            <div className="flex h-16 items-center">
              <ExternalLink reference={r}>
                <Logo reference={r} className="max-h-14 w-auto max-w-48 object-contain" />
              </ExternalLink>
            </div>
            <p className="mt-3 text-xs font-medium text-warning">{r.sector}</p>
            <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

/** Page /references : témoignages. La section entière disparaît s'il n'y en a aucun de publié. */
export function TestimonialsSection() {
  const testimonials = useAsync(listPublicTestimonials);
  if (testimonials.status !== "success" || testimonials.data.length === 0) return null;
  return (
    <Section title="Témoignages" tone="muted">
      <div className="grid gap-4 md:grid-cols-2">
        {testimonials.data.map((t) => (
          <blockquote key={t.id} className="rounded-lg bg-background p-4 text-sm">
            <Quote className="mb-2 h-5 w-5 text-warning" aria-hidden />
            <p>{t.quote}</p>
            <footer className="mt-3 text-xs text-muted-foreground">
              — <strong className="text-foreground">{t.author}</strong>, {t.authorRole}, {t.company}
            </footer>
          </blockquote>
        ))}
      </div>
    </Section>
  );
}
