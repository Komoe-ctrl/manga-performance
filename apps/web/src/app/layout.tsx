import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { SessionProvider } from "@/lib/auth/session";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

// TODO: à confirmer par le client — langue : français uniquement, ou aussi l'anglais ?
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "MANGA PERFORMANCE", template: "%s | MANGA PERFORMANCE" },
  description: "Diakité Manga, consultant indépendant en Audit, Data Analytique et Contrôle de Gestion à Abidjan : optimisez vos coûts, pilotez votre performance.",
  openGraph: { siteName: "MANGA PERFORMANCE", locale: "fr_FR", type: "website", images: [{ url: "/images/og.png", width: 1200, height: 630, alt: "MANGA PERFORMANCE — Audit, Data, Contrôle de gestion" }] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-foreground">
          Aller au contenu
        </a>
        <SessionProvider>{children}</SessionProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
