import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/public/section";
import { references, testimonials } from "@/lib/content/site";

export const metadata: Metadata = {
  title: "Références",
  description: "Études de cas anonymisées et témoignages de clients.",
  openGraph: { title: "Références | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <PageIntro title="Références" description="Des missions concrètes, des résultats mesurés (anonymisés)." />
      <Section title="Études de cas">
        <div className="grid gap-4 md:grid-cols-3">
          {references.map((r) => (
            <article key={r.sector} className="rounded-lg border border-border p-4">
              <h3 className="font-bold text-primary">{r.sector}</h3>
              <dl className="mt-2 space-y-2 text-sm">
                <div><dt className="font-medium">Contexte</dt><dd className="text-muted-foreground">{r.context}</dd></div>
                <div><dt className="font-medium">Mission</dt><dd className="text-muted-foreground">{r.mission}</dd></div>
                <div><dt className="font-medium">Résultats</dt><dd className="text-muted-foreground">{r.result}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </Section>
      <Section title="Témoignages" tone="muted">
        <div className="grid gap-4 md:grid-cols-2">
          {testimonials.map((t) => (
            <blockquote key={t.author} className="rounded-lg bg-background p-4 text-sm">
              <p>{t.quote}</p>
              <footer className="mt-2 text-xs text-muted-foreground">— {t.author}</footer>
            </blockquote>
          ))}
        </div>
      </Section>
    </>
  );
}
