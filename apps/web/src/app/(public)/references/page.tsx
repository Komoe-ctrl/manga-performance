import type { Metadata } from "next";
import { PageIntro } from "@/components/public/section";
import { ReferencesGrid, TestimonialsSection } from "@/components/public/references";

export const metadata: Metadata = {
  title: "Références",
  description: "Les entreprises qui nous font confiance et ce qu'elles disent de notre accompagnement.",
  openGraph: { title: "Références | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <PageIntro title="Références" description="Les entreprises qui nous font confiance." />
      <ReferencesGrid />
      <TestimonialsSection />
    </>
  );
}
