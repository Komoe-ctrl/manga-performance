import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { MoreLink } from "@/components/shared/more-link";
import { consultant, formulas, keyMissions, problems, sectors } from "@/lib/content/profile";
import { cn } from "@/lib/utils/cn";
import { Section } from "./section";

/** Portrait rond cerclé d'or, comme sur la fiche de présentation. */
export function ConsultantPhoto({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <div className={cn("relative aspect-square overflow-hidden rounded-full border-4 border-accent bg-white shadow-xl ring-8 ring-accent/20", className)}>
      <Image
        src={consultant.photo}
        alt={consultant.photoAlt}
        width={636}
        height={724}
        priority={priority}
        sizes="(min-width: 768px) 320px, 240px"
        className="h-full w-full object-cover object-top"
      />
    </div>
  );
}

export function ProblemChips() {
  return (
    <Section title="Vous vous reconnaissez ?" intro="Les situations dans lesquelles les dirigeants me sollicitent le plus souvent.">
      <ul className="reveal flex flex-wrap gap-3">
        {problems.map((p) => (
          <li key={p} className="card-lift rounded-full border border-border bg-muted px-5 py-2.5 text-sm font-medium text-primary">
            {p}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function AboutTeaser() {
  return (
    <Section tone="muted">
      <div className="reveal grid items-center gap-10 md:grid-cols-[auto_1fr]">
        <ConsultantPhoto className="mx-auto h-56 w-56 md:h-64 md:w-64" />
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-warning">Qui suis-je ?</p>
          <h2 className="mt-1 text-2xl font-bold text-primary md:text-3xl">{consultant.name}, {consultant.role.toLowerCase()}</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">{consultant.bio}</p>
          <blockquote className="mt-4 border-l-4 border-accent pl-4 italic text-primary">« {consultant.quote} »</blockquote>
          <MoreLink href="/a-propos" className="mt-6">Faire connaissance</MoreLink>
        </div>
      </div>
    </Section>
  );
}

export function KeyMissions() {
  return (
    <ul className="space-y-3">
      {keyMissions.map((m) => (
        <li key={m.title} className="card-lift flex gap-4 rounded-xl border border-border bg-background p-4">
          <span className="w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          <div className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:gap-4">
            <h3 className="font-bold text-primary">{m.title}</h3>
            <p className="text-sm text-muted-foreground">{m.text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SectorChips() {
  return (
    <ul className="flex flex-wrap gap-3">
      {sectors.map((s) => (
        <li key={s} className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">{s}</li>
      ))}
    </ul>
  );
}

/** Formules d'accompagnement : pas de prix, devis sur mesure. */
export function Formulas({ tone = "plain" }: { tone?: "plain" | "muted" }) {
  return (
    <Section title="Formules d'accompagnement" intro="Trois façons de travailler ensemble, chiffrées sur mesure selon votre entreprise." tone={tone}>
      <div className="reveal grid gap-4 md:grid-cols-3">
        {formulas.map((f) => (
          <article
            key={f.name}
            className={cn(
              "card-lift relative flex flex-col rounded-2xl border bg-background p-6",
              f.featured ? "border-accent shadow-lg shadow-accent/20" : "border-border",
            )}
          >
            {f.featured && (
              <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-0.5 text-xs font-bold text-accent-foreground">Le plus complet</span>
            )}
            <h3 className="text-lg font-bold text-primary">{f.name}</h3>
            <p className="mt-1 text-3xl font-extrabold text-primary">{f.duration}</p>
            <p className="mt-3 flex flex-1 items-start gap-2 text-sm text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> {f.detail}
            </p>
            <Link href="/contact" className={buttonVariants({ variant: f.featured ? "accent" : "outline", className: "mt-6" })}>
              Demander un devis <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </article>
        ))}
      </div>
    </Section>
  );
}
