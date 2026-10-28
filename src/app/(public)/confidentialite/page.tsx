import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/public/section";
import { contactInfo, TBD } from "@/lib/content/site";

export const metadata: Metadata = { title: "Politique de confidentialité", robots: { index: false } };

export default function Page() {
  return (
    <>
      <PageIntro title="Politique de confidentialité" />
      <Section>
        <div className="max-w-2xl space-y-3 text-sm">
          <p>
            Les données collectées via le formulaire de contact, la newsletter et le chatbot servent uniquement à répondre
            à vos demandes et à vous informer, dans le respect de la loi ivoirienne n° 2013-450 sur la protection des
            données à caractère personnel.
          </p>
          <p>Vous pouvez demander l&apos;accès, la rectification ou la suppression de vos données à tout moment en écrivant à <a href={`mailto:${contactInfo.email}`} className="underline">{contactInfo.email}</a>.</p>
          <p>
            <strong>Texte juridique définitif :</strong> {TBD}
          </p>
        </div>
      </Section>
    </>
  );
}
