import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/public/section";
import { LegalInfo } from "@/components/public/legal-details";
import { contactInfo } from "@/lib/content/site";

export const metadata: Metadata = { title: "Mentions légales", robots: { index: false } };

export default function Page() {
  return (
    <>
      <PageIntro title="Mentions légales" />
      <Section>
        <div className="max-w-2xl space-y-3 text-sm">
          <p><strong>Éditeur :</strong> MANGA PERFORMANCE, Abidjan, Côte d&apos;Ivoire.</p>
          <p><strong>Contact :</strong> <a href={`mailto:${contactInfo.email}`} className="underline">{contactInfo.email}</a> · {contactInfo.phone}</p>
          <LegalInfo />
        </div>
      </Section>
    </>
  );
}
