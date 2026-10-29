import Link from "next/link";
import { ArrowRight, Mail, MapPin, Phone } from "lucide-react";
import { contactInfo, services } from "@/lib/content/site";
import { publicNav } from "@/lib/nav";
import { buttonVariants } from "@/components/ui/button";
import { PublicNav } from "./mobile-nav";
import { BackToTop } from "@/components/public/back-to-top";
import { ChatWidget } from "@/components/public/chat-widget";
import { CopyrightYear } from "@/components/public/copyright";
import { SocialLinks } from "@/components/public/social-icons";
import { WhatsAppFab } from "@/components/public/whatsapp";

function FooterTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-white">
      {children}
    </h2>
  );
}

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="scroll-progress" aria-hidden="true" />
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4">
          <Link href="/" aria-label="MANGA PERFORMANCE — retour à l'accueil" className="font-heading text-lg font-extrabold text-primary transition-transform hover:scale-[1.03] active:scale-95">
            MANGA <span className="rounded bg-accent px-1.5 text-accent-foreground">PERFORMANCE</span>
          </Link>
          <PublicNav />
        </div>
      </header>
      <main id="contenu" tabIndex={-1} className="flex-1">{children}</main>

      <footer className="relative overflow-hidden bg-primary text-slate-300">
        <div className="hero-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
        <div className="relative h-1 bg-gradient-to-r from-accent via-amber-200 to-accent" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl px-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 py-10">
            <div>
              <p className="font-heading text-2xl font-bold text-white md:text-3xl">Prêt à reprendre la main sur vos coûts ?</p>
              <p className="mt-1 text-slate-300">Échangeons 30 minutes sur votre situation, sans engagement.</p>
            </div>
            <Link href="/contact" className={buttonVariants({ variant: "accent", size: "lg", className: "btn-shine" })}>
              Prendre rendez-vous <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
          </div>

          <div className="grid gap-10 py-12 text-sm sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
            <div>
              <p className="font-heading text-xl font-extrabold text-white">
                MANGA <span className="rounded bg-accent px-1.5 text-accent-foreground">PERFORMANCE</span>
              </p>
              <p className="mt-3 max-w-xs leading-relaxed">
                Cabinet de conseil indépendant à Abidjan : audit, data et contrôle de gestion pour les entreprises ivoiriennes.
              </p>
              <SocialLinks />
            </div>

            <nav aria-label="Pages du site">
              <FooterTitle>Le cabinet</FooterTitle>
              <ul className="space-y-1.5">
                {publicNav.map((item) => (
                  <li key={item.href}><Link href={item.href} className="footer-link">{item.label}</Link></li>
                ))}
              </ul>
            </nav>

            <nav aria-label="Nos services">
              <FooterTitle>Services</FooterTitle>
              <ul className="space-y-1.5">
                {services.map((s) => (
                  <li key={s.slug}><Link href={`/services/${s.slug}`} className="footer-link">{s.title}</Link></li>
                ))}
              </ul>
            </nav>

            <div>
              <FooterTitle>Contact</FooterTitle>
              <ul className="space-y-2.5">
                <li className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />{contactInfo.address}</li>
                <li className="flex gap-2">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <a href={`tel:${contactInfo.phone.replace(/\s/g, "")}`} className="footer-link">{contactInfo.phone}</a>
                </li>
                <li className="flex gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <a href={`mailto:${contactInfo.email}`} className="footer-link break-all">{contactInfo.email}</a>
                </li>
                <li className="text-xs text-slate-400">{contactInfo.hours}</li>
              </ul>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/espace-client" className={buttonVariants({ variant: "outlineLight", size: "sm" })}>Espace client</Link>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 py-5 text-xs">
            <p>© <CopyrightYear /> MANGA PERFORMANCE — Tous droits réservés</p>
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              <li><Link href="/mentions-legales" className="footer-link">Mentions légales</Link></li>
              <li><Link href="/confidentialite" className="footer-link">Confidentialité</Link></li>
            </ul>
            <BackToTop />
          </div>
        </div>
      </footer>

      {/* Chatbot empilé au-dessus du bouton WhatsApp : pas de chevauchement */}
      <ChatWidget />
      <WhatsAppFab />
    </>
  );
}
