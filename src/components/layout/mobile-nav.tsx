"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, UserRound, X } from "lucide-react";
import { publicNav } from "@/lib/nav";
import { cn } from "@/lib/utils/cn";
import { buttonVariants } from "@/components/ui/button";

// L'accueil est accessible par le logo.
const items = publicNav.filter((i) => i.href !== "/");

/** Petit point qui pulse pendant la navigation vers la page cliquée. */
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-ping rounded-full bg-accent" aria-hidden="true" /> : null;
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Navigation du site public : barre horizontale dès md, menu repliable en dessous. */
export function PublicNav() {
  const [openAt, setOpenAt] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openAt === pathname; // le menu se referme à chaque changement de page

  return (
    <>
      <nav aria-label="Navigation principale" className="hidden items-center gap-1 text-sm lg:flex">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("nav-link flex items-center whitespace-nowrap rounded-md px-3 py-2 font-medium", active ? "text-primary" : "text-slate-600 hover:bg-muted hover:text-primary")}
            >
              {item.label}
              <Pending />
            </Link>
          );
        })}
        <Link href="/espace-client" aria-label="Espace client" title="Espace client" className={buttonVariants({ variant: "ghost", size: "md", className: "ml-1 hidden h-10 w-10 shrink-0 px-0 xl:inline-flex" })}>
          <UserRound className="h-5 w-5" aria-hidden />
        </Link>
        <Link href="/contact" className={buttonVariants({ variant: "accent", size: "md", className: "btn-shine ml-1 hidden shrink-0 whitespace-nowrap xl:inline-flex" })}>
          Prendre rendez-vous <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </nav>

      <button
        className="rounded-md p-2 hover:bg-muted active:scale-95 lg:hidden"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
        onClick={() => setOpenAt(open ? null : pathname)}
      >
        {open ? <X aria-hidden /> : <Menu aria-hidden />}
      </button>
      {open && (
        <nav id="mobile-menu" aria-label="Navigation principale" className="rise absolute left-0 right-0 top-16 border-b border-border bg-background p-4 shadow-lg lg:hidden">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center rounded-md border-l-4 px-3 py-3 font-medium transition-colors",
                      active ? "border-accent bg-accent/15 text-primary" : "border-transparent hover:bg-muted active:bg-accent/20",
                    )}
                  >
                    {item.label}
                    <Pending />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link href="/espace-client" className={buttonVariants({ variant: "outline", className: "mt-3 w-full" })}>
            <UserRound className="h-4 w-4" aria-hidden /> Espace client
          </Link>
          <Link href="/contact" className={buttonVariants({ variant: "accent", className: "mt-2 w-full" })}>
            Prendre rendez-vous
          </Link>
        </nav>
      )}
    </>
  );
}
