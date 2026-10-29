import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Section } from "@/components/public/section";
import { MoreLabel } from "@/components/shared/more-link";
import { Formulas } from "@/components/public/profile-sections";
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
            <Link key={s.slug} href={`/services/${s.slug}`} className="card-lift group rounded-xl border border-border p-6">
              <h2 className="text-xl font-bold text-primary">{s.title}</h2>
              <p className="mt-2 text-muted-foreground">{s.short}</p>
              <span className="mt-4 inline-block"><MoreLabel>Voir le détail</MoreLabel></span>
            </Link>
          ))}
        </div>
      </Section>
      <Formulas tone="muted" />
    </>
  );
}
