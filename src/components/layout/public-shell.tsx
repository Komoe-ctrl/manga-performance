import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { publicNav, WHATSAPP_NUMBER } from "@/lib/nav";

export function PublicShell({ children }: { children: React.ReactNode }) {
  const wa = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Bonjour, je souhaite en savoir plus sur vos services.")}`;
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="font-heading text-lg font-extrabold text-primary">
            MANGA <span className="rounded bg-accent px-1.5 text-accent-foreground">PERFORMANCE</span>
          </Link>
          <nav aria-label="Navigation principale" className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm">
            {publicNav.map((item) => (
              <Link key={item.href} href={item.href} className="py-1 hover:text-primary hover:underline">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm">
          <p>© 2026 MANGA PERFORMANCE — Abidjan, Côte d&apos;Ivoire</p>
          <div className="flex gap-4">
            <Link href="/mentions-legales" className="hover:underline">Mentions légales</Link>
            <Link href="/confidentialite" className="hover:underline">Confidentialité</Link>
            <Link href="/admin" className="hover:underline">Back-office</Link>
            <Link href="/espace-client" className="hover:underline">Espace client</Link>
          </div>
        </div>
      </footer>
      {/* Le widget chatbot (étape 8) sera empilé au-dessus de ce bouton. */}
      <a
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Nous écrire sur WhatsApp"
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg"
      >
        <MessageCircle aria-hidden />
      </a>
    </>
  );
}
