"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BellRing,
  Building2,
  Globe,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Newspaper,
  PenSquare,
  Radar,
  Receipt,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { GlobalSearch } from "./global-search";
import { FollowUpBell } from "./follow-up-bell";
import { adminNav } from "@/lib/nav";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/prospects": Users,
  "/admin/relances": BellRing,
  "/admin/clients": Building2,
  "/admin/factures": Receipt,
  "/admin/sequences": Mail,
  "/admin/newsletter": Newspaper,
  "/admin/blog": PenSquare,
  "/admin/scraper": Radar,
  "/admin/parametres": Settings,
};

/** Point qui pulse pendant le chargement de la page cliquée. */
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="ml-auto h-2 w-2 animate-ping rounded-full bg-accent" aria-hidden="true" /> : null;
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === href : pathname.startsWith(href));

  const link = (href: string, label: string) => {
    const Icon = ICONS[href] ?? BarChart3;
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 active:scale-[0.98]",
          active
            ? "bg-accent font-semibold text-accent-foreground shadow-md shadow-black/20"
            : "text-slate-300 hover:bg-white/10 hover:text-white",
        )}
      >
        <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110", active ? "text-accent-foreground" : "text-accent")} aria-hidden />
        {label}
        <Pending />
      </Link>
    );
  };

  return (
    <nav aria-label="Navigation back-office" className="space-y-1">
      {adminNav.map((item) =>
        item.children ? (
          <div key={item.label} className="pt-4">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">{item.label}</p>
            <div className="space-y-1">{item.children.map((c) => link(c.href, c.label))}</div>
          </div>
        ) : (
          <div key={item.href}>{link(item.href, item.label)}</div>
        ),
      )}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/admin" className="mb-5 block px-3 font-heading text-lg font-extrabold leading-tight text-white">
      MANGA <span className="rounded bg-accent px-1.5 text-accent-foreground">PERFORMANCE</span>
      <span className="mt-1 block text-[11px] font-medium uppercase tracking-widest text-slate-500">Back-office</span>
    </Link>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { session, ready, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (ready && session?.role !== "consultant") router.replace("/admin/connexion");
  }, [ready, session, router]);

  if (!ready || session?.role !== "consultant") {
    return <p className="p-8 text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <div className="flex min-h-screen">
      {/* Barre latérale fixe : elle reste visible pendant le défilement de la page */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-primary p-4 md:flex">
        <Brand />
        <div className="flex-1"><SideNav /></div>
        <Link href="/" className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
          <Globe className="h-[18px] w-[18px]" aria-hidden /> Voir le site public
        </Link>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/50" aria-label="Fermer le menu" onClick={() => setOpen(false)} />
          <aside className="rise relative flex h-full w-72 flex-col overflow-y-auto bg-primary p-4">
            <button className="mb-2 self-end rounded-md p-1 text-white hover:bg-white/10" aria-label="Fermer" onClick={() => setOpen(false)}>
              <X />
            </button>
            <Brand />
            <SideNav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur">
          <button className="rounded-md p-2 hover:bg-muted md:hidden" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}>
            <Menu />
          </button>
          <GlobalSearch />
          <FollowUpBell />
          <button
            onClick={() => {
              signOut();
              router.push("/admin/connexion");
            }}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all hover:bg-muted active:scale-95"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Déconnexion
          </button>
        </header>
        <main id="contenu" tabIndex={-1} className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
