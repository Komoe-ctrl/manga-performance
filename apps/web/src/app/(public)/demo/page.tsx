import type { Metadata } from "next";
import { DemoTabs } from "@/components/demo/demo-tabs";
import { PageIntro, Section } from "@/components/public/section";

export const metadata: Metadata = {
  title: "Dashboard de démonstration",
  description: "Exemples de tableaux de bord de pilotage pour l'hôtellerie, la restauration, le commerce, le BTP et la tech (données fictives, en FCFA).",
  openGraph: { title: "Dashboard de démonstration | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <PageIntro title="Dashboard de démonstration" description="Cinq secteurs, des données fictives : explorez les indicateurs, les tendances et les alertes." />
      <Section>
        <DemoTabs />
      </Section>
    </>
  );
}
