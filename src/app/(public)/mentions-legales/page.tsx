import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/public/section";
import { TBD } from "@/lib/content/site";

export const metadata: Metadata = { title: "Mentions légales", robots: { index: false } };

export default function Page() {
  return (
    <>
      <PageIntro title="Mentions légales" />
      <Section>
        <div className="max-w-2xl space-y-3 text-sm">
          <p><strong>Éditeur :</strong> MANGA PERFORMANCE, Abidjan, Côte d&apos;Ivoire.</p>
          <p><strong>Forme juridique, RCCM, capital :</strong> {TBD}</p>
          <p><strong>Directeur de la publication :</strong> {TBD}</p>
          <p><strong>Hébergeur :</strong> {TBD}</p>
        </div>
      </Section>
    </>
  );
}
