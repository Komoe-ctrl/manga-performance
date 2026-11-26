"use client";

import { Quote } from "lucide-react";
import { faqJsonLd } from "@/lib/content/public-profile";
import { useAsync } from "@/lib/hooks/use-async";
import { getPublicProfile } from "@/lib/services";

/**
 * Cas client d'une page de service. Tant qu'il n'est pas fourni (dans l'admin, Paramètres → Pages publiques), le
 * bloc n'existe pas pour le public : pas de titre vide, pas de texte provisoire.
 */
export function ServiceCaseStudy({ slug }: { slug: string }) {
  const profile = useAsync(getPublicProfile);
  const caseStudy = profile.status === "success" ? profile.data.services[slug]?.caseStudy : undefined;
  if (!caseStudy) return null;
  return (
    <section aria-labelledby={`case-${slug}`}>
      <h2 id={`case-${slug}`} className="text-xl font-bold text-primary">Cas client</h2>
      <figure className="mt-3 rounded-xl border border-border bg-muted/40 p-5">
        <Quote className="mb-2 h-5 w-5 text-warning" aria-hidden />
        <p>{caseStudy.summary}</p>
        <figcaption className="mt-3 text-sm font-semibold text-primary">{caseStudy.client}</figcaption>
      </figure>
    </section>
  );
}

/** Foire aux questions avec ses données structurées (JSON-LD `FAQPage`) ; rien tant qu'aucune question n'est fournie. */
export function ServiceFaq({ slug }: { slug: string }) {
  const profile = useAsync(getPublicProfile);
  const faq = profile.status === "success" ? (profile.data.services[slug]?.faq ?? []) : [];
  const jsonLd = faqJsonLd(faq);
  if (!jsonLd) return null;
  return (
    <section aria-labelledby={`faq-${slug}`}>
      <h2 id={`faq-${slug}`} className="text-xl font-bold text-primary">Questions fréquentes</h2>
      <div className="mt-3 divide-y divide-border rounded-xl border border-border">
        {faq.map((item) => (
          <details key={item.question} className="group p-4">
            <summary className="cursor-pointer list-none font-semibold text-primary [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
              {item.question}
            </summary>
            <p className="mt-2 text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>
      {/* `<` is escaped so that no answer can close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </section>
  );
}
