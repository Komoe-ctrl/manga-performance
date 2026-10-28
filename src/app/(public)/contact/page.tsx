import type { Metadata } from "next";
import { ContactForm } from "@/components/public/contact-form";
import { PageIntro, Section } from "@/components/public/section";
import { contactInfo } from "@/lib/content/site";
import { WhatsAppButton } from "@/components/public/whatsapp";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contactez MANGA PERFORMANCE : formulaire, WhatsApp ou prise de rendez-vous.",
  openGraph: { title: "Contact | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <PageIntro title="Contact" description="Parlez-nous de votre besoin : réponse sous 24 h ouvrées." />
      <Section>
        <div className="grid gap-10 md:grid-cols-2">
          <ContactForm />
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-primary">Coordonnées</h2>
              <ul className="mt-2 space-y-1 text-sm">
                <li>{contactInfo.address}</li>
                <li><a href={`tel:${contactInfo.phone.replace(/s/g, "")}`} className="underline">{contactInfo.phone}</a></li>
                <li><a href={`mailto:${contactInfo.email}`} className="underline">{contactInfo.email}</a></li>
                <li>{contactInfo.hours}</li>
              </ul>
              <WhatsAppButton message="Bonjour, je souhaite prendre contact avec MANGA PERFORMANCE." className="mt-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-primary">Prendre rendez-vous</h2>
              {/* TODO: intégration Calendly réelle (hors périmètre de la maquette) */}
              <div
                role="img"
                aria-label="Emplacement du calendrier de prise de rendez-vous"
                className="mt-2 flex h-56 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-sm text-muted-foreground"
              >
                Calendrier Calendly (intégration à venir)
              </div>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
