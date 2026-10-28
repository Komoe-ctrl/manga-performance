"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { publicNav } from "@/lib/nav";
import { cn } from "@/lib/utils/cn";

/** Navigation du site public : barre horizontale dès md, menu repliable en dessous. */
export function PublicNav() {
  const [openAt, setOpenAt] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openAt === pathname; // le menu se referme à chaque changement de page

  return (
    <>
      <nav aria-label="Navigation principale" className="hidden gap-x-4 text-sm md:flex">
        {publicNav.map((item) => (
          <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={cn("py-1 hover:underline", pathname === item.href && "font-semibold text-primary")}>
            {item.label}
          </Link>
        ))}
      </nav>
      <button className="p-2 md:hidden" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Fermer le menu" : "Ouvrir le menu"} onClick={() => setOpenAt(open ? null : pathname)}>
        {open ? <X aria-hidden /> : <Menu aria-hidden />}
      </button>
      {open && (
        <nav id="mobile-menu" aria-label="Navigation principale" className="absolute left-0 right-0 top-16 border-b border-border bg-background p-4 md:hidden">
          <ul className="space-y-1">
            {publicNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined} className="block rounded px-2 py-2 hover:bg-muted">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
