import Link from "next/link";
import { contactInfo } from "@/lib/content/site";
import { PublicNav } from "./mobile-nav";
import { ChatWidget } from "@/components/public/chat-widget";
import { SocialLinks } from "@/components/public/social-icons";
import { CopyrightYear } from "@/components/public/copyright";
import { WhatsAppFab } from "@/components/public/whatsapp";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="scroll-progress" aria-hidden="true" />
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="font-heading text-lg font-extrabold text-primary">
            MANGA <span className="rounded bg-accent px-1.5 text-accent-foreground">PERFORMANCE</span>
          </Link>
          <PublicNav />
        </div>
      </header>
      <main id="contenu" tabIndex={-1} className="flex-1">{children}</main>
      <footer className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-heading text-base font-extrabold">MANGA PERFORMANCE</p>
            <p className="mt-2 text-slate-300">Audit, data et contrôle de gestion pour les entreprises ivoiriennes.</p>
          </div>
          <div>
            <h2 className="font-semibold">Contact</h2>
            <ul className="mt-2 space-y-1 text-slate-300">
              <li>{contactInfo.address}</li>
              <li><a href={`tel:${contactInfo.phone.replace(/\s/g, "")}`} className="hover:underline">{contactInfo.phone}</a></li>
              <li><a href={`mailto:${contactInfo.email}`} className="hover:underline">{contactInfo.email}</a></li>
              <li>{contactInfo.hours}</li>
            </ul>
          </div>
          <div>
            <h2 className="font-semibold">Suivez-nous</h2>
            <SocialLinks />
          </div>
          <div>
            <h2 className="font-semibold">Informations</h2>
            <ul className="mt-2 space-y-1 text-slate-300">
              <li><Link href="/mentions-legales" className="hover:underline">Mentions légales</Link></li>
              <li><Link href="/confidentialite" className="hover:underline">Confidentialité</Link></li>
              <li><Link href="/admin" className="hover:underline">Back-office</Link></li>
              <li><Link href="/espace-client" className="hover:underline">Espace client</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-slate-300">
          © <CopyrightYear /> MANGA PERFORMANCE — Tous droits réservés
        </div>
      </footer>
      {/* Chatbot empilé au-dessus du bouton WhatsApp : pas de chevauchement */}
      <ChatWidget />
      <WhatsAppFab />
    </>
  );
}
