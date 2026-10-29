import { cn } from "@/lib/utils/cn";

export function Section({
  title,
  intro,
  tone = "plain",
  children,
}: {
  title?: string;
  intro?: string;
  tone?: "plain" | "muted";
  children: React.ReactNode;
}) {
  return (
    <section className={cn("py-12", tone === "muted" && "bg-muted")}>
      <div className="mx-auto max-w-6xl px-4">
        {title && <h2 className="reveal text-2xl font-bold text-primary">{title}</h2>}
        {intro && <p className="mt-2 max-w-2xl text-muted-foreground">{intro}</p>}
        <div className={title ? "mt-6" : undefined}>{children}</div>
      </div>
    </section>
  );
}

export function PageIntro({ title, description }: { title: string; description?: string }) {
  return (
    <div className="relative overflow-hidden bg-primary text-primary-foreground">
      <div className="hero-grid absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 py-14">
        <h1 className="rise text-3xl font-bold md:text-4xl">{title}</h1>
        {description && <p className="rise mt-2 max-w-2xl text-slate-200" style={{ "--i": 1 } as React.CSSProperties}>{description}</p>}
      </div>
    </div>
  );
}
