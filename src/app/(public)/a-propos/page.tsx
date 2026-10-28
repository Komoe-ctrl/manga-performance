import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/public/section";
import { TBD } from "@/lib/content/site";

export const metadata: Metadata = {
  title: "À propos",
  description: "Consultant indépendant, MBA Audit & Contrôle de Gestion, plus de 10 ans d'expérience.",
  openGraph: { title: "À propos | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <PageIntro title="À propos" description="Un cabinet indépendant, au service du pilotage de votre performance." />
      <Section title="Parcours">
        <p className="max-w-2xl">{TBD} Présentation du parcours professionnel du consultant.</p>
      </Section>
      <Section title="Diplômes et expérience" tone="muted">
        <ul className="list-disc space-y-1 pl-5">
          <li>MBA Audit &amp; Contrôle de Gestion</li>
          <li>Plus de 10 ans d&apos;expérience en audit, data et contrôle de gestion</li>
          <li>{TBD} Autres diplômes et certifications</li>
        </ul>
      </Section>
      <Section title="Approche">
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            ["Comprendre", "Cadrer votre activité, vos chiffres et vos enjeux."],
            ["Mesurer", "Mettre en place des indicateurs fiables et utiles."],
            ["Piloter", "Transmettre les outils et accompagner leur usage."],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-lg border border-border p-4">
              <p className="text-sm font-semibold text-warning">Étape {i + 1}</p>
              <h3 className="font-bold text-primary">{t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
