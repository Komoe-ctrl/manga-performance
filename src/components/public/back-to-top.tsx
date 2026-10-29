"use client";

import { ArrowUp } from "lucide-react";

export function BackToTop() {
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="flex items-center gap-2 rounded-full border border-white/25 px-4 py-2 text-xs font-medium text-white transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-accent hover:text-accent-foreground active:scale-95"
    >
      <ArrowUp className="h-4 w-4" aria-hidden /> Retour en haut
    </button>
  );
}
