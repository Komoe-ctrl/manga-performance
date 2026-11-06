import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Espace client", template: "%s | Espace client" } };

export default function ClientRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
