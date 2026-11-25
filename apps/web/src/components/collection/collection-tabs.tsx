"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/admin/collecte", label: "Suivi" },
  { href: "/admin/collecte/entites", label: "Entités et plans" },
  { href: "/admin/collecte/exports", label: "Exports consolidés" },
  { href: "/admin/collecte/pilote", label: "Pilote hôtellerie" },
  { href: "/admin/collecte/referentiels", label: "Référentiels" },
  { href: "/admin/collecte/parametres", label: "Paramètres" },
];

export function CollectionTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections de la collecte" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors", active ? "border-accent text-primary" : "border-transparent text-muted-foreground hover:text-primary")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
