import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/** Symbole seul (barres, flèche, arcs dorés) : lisible dès 28 px, pour les barres de navigation. */
export function LogoMark({ className }: { className?: string }) {
  return <Image src="/images/logo-mark.png" alt="" width={160} height={160} className={cn("h-9 w-9 shrink-0", className)} />;
}

/** Symbole + nom en texte vivant (net à toute taille). `tone="light"` pour les fonds sombres. */
export function BrandLockup({ tone = "dark", className, caption }: { tone?: "dark" | "light"; className?: string; caption?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className={cn("shrink-0 rounded-lg", tone === "light" && "bg-white p-0.5")}>
        <LogoMark className="h-9 w-9" />
      </span>
      <span className="flex flex-col leading-none">
        <span className={cn("font-heading text-[17px] font-extrabold tracking-wide", tone === "light" ? "text-white" : "text-primary")}>MANGA</span>
        <span className="mt-0.5 font-heading text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">Performance</span>
        {caption && <span className="mt-1 text-[10px] font-medium uppercase tracking-widest text-slate-500">{caption}</span>}
      </span>
    </span>
  );
}

/** Logo complet fourni par le client, posé sur une pastille blanche pour les fonds sombres. */
export function LogoFull({ className, framed = false }: { className?: string; framed?: boolean }) {
  const img = <Image src="/images/logo.png" alt="MANGA PERFORMANCE — Audit, Data, Contrôle de gestion" width={948} height={835} className={cn("h-auto w-full", className)} />;
  return framed ? <div className="rounded-2xl bg-white p-4 shadow-lg">{img}</div> : img;
}
