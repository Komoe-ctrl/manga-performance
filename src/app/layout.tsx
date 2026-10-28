import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { SessionProvider } from "@/lib/auth/session";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "MANGA PERFORMANCE", template: "%s | MANGA PERFORMANCE" },
  description: "Cabinet de conseil en Audit, Data et Contrôle de Gestion à Abidjan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SessionProvider>{children}</SessionProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
