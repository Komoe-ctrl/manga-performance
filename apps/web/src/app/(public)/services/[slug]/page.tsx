import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageIntro, Section } from "@/components/public/section";
import { WhatsAppButton } from "@/components/public/whatsapp";
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
  const others = services.filter((x) => x.slug !== s.slug);

  return (
    <>
      <PageIntro title={s.title} description={s.short} />
      <Section>
        <Link href="/services" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Tous les services
        </Link>
        <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
          <div className="space-y-10">
            <div>
              <h2 className="text-xl font-bold text-primary">Le problème</h2>
              <p className="mt-3 max-w-2xl">{s.problem}</p>
            </div>
            <div>
              <h2 className="text-xl font-bold text-primary">Notre approche</h2>
              <ol className="mt-3 space-y-3">
                {s.approach.map((a, i) => (
                  <li key={a} className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{i + 1}</span>
                    <span className="pt-0.5">{a}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h2 className="text-xl font-bold text-primary">Livrables</h2>
              <ul className="mt-3 space-y-2">
                {s.deliverables.map((d) => (
                  <li key={d} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-xl border border-border bg-muted/40 p-6">
              <p className="font-bold text-primary">Parlons de votre besoin</p>
              <p className="mt-1 text-sm text-muted-foreground">Un échange de 30 minutes, sans engagement, pour cadrer la mission et son coût.</p>
              <Link href="/contact" className={buttonVariants({ variant: "accent", size: "lg", className: "mt-4 w-full" })}>
                Discuter de mon besoin
              </Link>
              <WhatsAppButton message={`Bonjour, je souhaite en savoir plus sur « ${s.title} ».`} className="mt-2 w-full" />
            </div>
            <div className="mt-6">
              <p className="mb-2 text-sm font-semibold text-primary">Autres services</p>
              <ul className="space-y-1.5">
                {others.map((o) => (
                  <li key={o.slug}>
                    <Link href={`/services/${o.slug}`} className="group flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-primary hover:bg-muted/50">
                      {o.title}
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
