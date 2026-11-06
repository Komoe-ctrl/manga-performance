import type { Metadata } from "next";
import { BlogList } from "@/components/public/blog";
import { PageIntro, Section } from "@/components/public/section";

export const metadata: Metadata = {
  title: "Blog",
  description: "Conseils de contrôle de gestion, data et audit pour les entreprises ivoiriennes.",
  openGraph: { title: "Blog | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <PageIntro title="Blog" description="Contrôle de gestion, data et audit." />
      <Section>
        <BlogList filterable />
      </Section>
    </>
  );
}
