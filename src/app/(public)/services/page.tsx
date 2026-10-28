import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Section } from "@/components/public/section";
import { services } from "@/lib/content/site";

export const metadata: Metadata = {
  title: "Services",
  description: "Business plan bancable, tableaux de bord KPI, trésorerie, maîtrise des coûts.",
  openGraph: { title: "Services | MANGA PERFORMANCE", type: "website", locale: "fr_FR" },
};

export default function Page() {
  return (
    <>
      <PageIntro title="Nos services" description="Quatre missions pour reprendre la main sur vos chiffres." />
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((s) => (
            <Link key={s.slug} href={`/services/${s.slug}`} className="rounded-lg border border-border p-6 hover:border-accent">
              <h2 className="text-xl font-bold text-primary">{s.title}</h2>
              <p className="mt-2 text-muted-foreground">{s.short}</p>
              <span className="mt-3 inline-block text-sm font-medium underline">Voir le détail</span>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
