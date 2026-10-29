import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { SessionProvider } from "@/lib/auth/session";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

// TODO: à confirmer par le client — langue : français uniquement, ou aussi l'anglais ?
export const metadata: Metadata = {
  title: { default: "MANGA PERFORMANCE", template: "%s | MANGA PERFORMANCE" },
  description: "Diakité Manga, consultant indépendant en Audit, Data Analytique et Contrôle de Gestion à Abidjan : optimisez vos coûts, pilotez votre performance.",
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
