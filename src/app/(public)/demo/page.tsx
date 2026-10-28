import type { Metadata } from "next";
import { DemoDashboard } from "@/components/demo/demo-dashboard";
import { PageIntro, Section } from "@/components/public/section";

export const metadata: Metadata = {
  title: "Dashboard de démonstration",
  description: "Exemple de tableau de bord de pilotage pour un groupe hôtelier (données fictives).",
  openGraph: { title: "Dashboard de démonstration | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <PageIntro title="Dashboard de démonstration" description="Filtrez par hôtel, produit et période pour explorer l'exemple." />
      <Section>
        <DemoDashboard />
      </Section>
    </>
  );
}
