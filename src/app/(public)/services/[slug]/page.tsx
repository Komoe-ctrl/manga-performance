import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { PageIntro, Section } from "@/components/public/section";
import { services } from "@/lib/content/site";

export function generateStaticParams() {
  return services.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = services.find((x) => x.slug === slug);
  if (!s) return {};
  return {
    title: s.title,
    description: s.short,
    openGraph: { title: `${s.title} | MANGA PERFORMANCE`, description: s.short, type: "website", locale: "fr_FR" },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = services.find((x) => x.slug === slug);
  if (!s) notFound();

  return (
    <>
      <PageIntro title={s.title} description={s.short} />
      <Section title="Le problème">
        <p className="max-w-2xl">{s.problem}</p>
      </Section>
      <Section title="Notre approche" tone="muted">
        <ol className="list-decimal space-y-1 pl-5">
          {s.approach.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      </Section>
      <Section title="Livrables">
        <ul className="list-disc space-y-1 pl-5">
          {s.deliverables.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <Link href="/contact" className={buttonVariants({ variant: "accent", size: "lg", className: "mt-8" })}>
          Discuter de mon besoin
        </Link>
      </Section>
    </>
  );
}
