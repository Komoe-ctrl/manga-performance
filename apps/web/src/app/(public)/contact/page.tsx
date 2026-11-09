import type { Metadata } from "next";
import { ContactForm } from "@/components/public/contact-form";
import { PageIntro, Section } from "@/components/public/section";
import { contactInfo } from "@/lib/content/site";
import { WhatsAppButton } from "@/components/public/whatsapp";
import { buttonVariants } from "@/components/ui/button";

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
                <li><a href={`tel:${contactInfo.phone.replace(/\s/g, "")}`} className="underline">{contactInfo.phone}</a></li>
                <li><a href={`mailto:${contactInfo.email}`} className="underline">{contactInfo.email}</a></li>
                <li>{contactInfo.hours}</li>
              </ul>
              <WhatsAppButton message="Bonjour, je souhaite prendre contact avec MANGA PERFORMANCE." className="mt-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-primary">Prendre rendez-vous</h2>
              {/* TODO: remplacer par le calendrier Calendly du client quand son lien sera fourni */}
              <div className="mt-2 space-y-3 rounded-xl border border-border bg-muted/40 p-5">
                <p className="text-sm text-muted-foreground">
                  Un échange de 30 minutes, sans engagement, pour faire le point sur votre situation. Choisissez ce qui vous convient :
                </p>
                <div className="flex flex-wrap gap-2">
                  <a href={"tel:" + contactInfo.phone.replace(/\s/g, "")} className={buttonVariants({ variant: "primary", size: "sm" })}>Appeler maintenant</a>
                  <a href={"mailto:" + contactInfo.email + "?subject=Demande%20de%20rendez-vous"} className={buttonVariants({ variant: "outline", size: "sm" })}>Proposer un créneau par email</a>
                </div>
                <p className="text-xs text-muted-foreground">{contactInfo.hours}</p>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
