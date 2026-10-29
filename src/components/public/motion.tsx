import { cn } from "@/lib/utils/cn";

/** Bandeau défilant infini (pause au survol). Le second jeu d'éléments est masqué aux lecteurs d'écran. */
export function Marquee({ items, reverse = false, className }: { items: string[]; reverse?: boolean; className?: string }) {
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li key={item} className="flex items-center whitespace-nowrap px-6">
          {item}
          <span className="ml-12 text-accent" aria-hidden="true">◆</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className={cn("marquee", reverse && "marquee-reverse", className)}>
      <div className="marquee-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

/** Visuel du hero : carte « photo » entourée de cartes KPI flottantes et d'une courbe qui se dessine. */
export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md" role="img" aria-label="Aperçu d'un tableau de bord de pilotage (photo du consultant à fournir)">
      <div className="orb absolute -inset-6 rounded-full bg-accent/30 blur-3xl" aria-hidden="true" />
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-white/20 to-white/5 text-sm text-slate-300 backdrop-blur">
        Photo du consultant
        <svg viewBox="0 0 300 120" className="absolute inset-x-0 bottom-0 h-1/3 w-full" aria-hidden="true">
          <path d="M0 100 C 40 90, 60 60, 100 70 S 170 30, 210 40 S 270 10, 300 15" fill="none" stroke="#F5B700" strokeWidth="3" strokeLinecap="round" className="draw" />
        </svg>
      </div>
      <div className="float absolute -left-4 top-8 rounded-xl bg-white px-4 py-3 text-primary shadow-xl sm:-left-10" aria-hidden="true">
        <p className="text-xs text-muted-foreground">Marge brute</p>
        <p className="text-lg font-bold">25,9 % <span className="text-xs font-medium text-success">▲ 0,7 pt</span></p>
      </div>
      <div className="float-slow absolute -right-3 top-1/2 rounded-xl bg-accent px-4 py-3 text-accent-foreground shadow-xl sm:-right-8" aria-hidden="true">
        <p className="text-xs">Point mort</p>
        <p className="text-lg font-bold">Atteint le 27 sept.</p>
      </div>
      <div className="float absolute -bottom-5 left-8 rounded-xl bg-white px-4 py-3 text-primary shadow-xl" aria-hidden="true" style={{ animationDelay: "1.2s" }}>
        <p className="text-xs text-muted-foreground">Trésorerie à 90 jours</p>
        <p className="text-lg font-bold text-success">Sous contrôle ✓</p>
      </div>
    </div>
  );
}
