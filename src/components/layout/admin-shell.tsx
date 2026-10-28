"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { GlobalSearch } from "./global-search";
import { FollowUpBell } from "./follow-up-bell";
import { adminNav } from "@/lib/nav";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils/cn";

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/admin" ? pathname === href : pathname.startsWith(href);
  const link = (href: string, label: string, nested = false) => (
    <Link
      key={href}
      href={href}
      onClick={onNavigate}
      aria-current={isActive(href) ? "page" : undefined}
      className={cn(
        "block rounded-md px-3 py-2 text-sm",
        nested && "ml-4",
        isActive(href)
          ? "bg-accent font-semibold text-accent-foreground"
          : "text-slate-200 hover:bg-white/10",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Navigation back-office" className="space-y-1">
      {adminNav.map((item) =>
        item.children ? (
          <div key={item.label} className="pt-2">
            <p className="px-3 pb-1 text-xs uppercase tracking-wide text-slate-400">{item.label}</p>
            {item.children.map((c) => link(c.href, c.label, true))}
          </div>
        ) : (
          link(item.href, item.label)
        ),
      )}
    </nav>
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
      <aside className="hidden w-60 shrink-0 bg-primary p-4 md:block">
        <p className="mb-4 px-3 font-heading font-extrabold text-white">MANGA PERFORMANCE</p>
        <SideNav />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/50" aria-label="Fermer le menu" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-64 bg-primary p-4">
            <button className="mb-2 text-white" aria-label="Fermer" onClick={() => setOpen(false)}>
              <X />
            </button>
            <SideNav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-border px-4">
          <button className="md:hidden" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}>
            <Menu />
          </button>
          <GlobalSearch />
          <FollowUpBell />
          <button
            onClick={() => {
              signOut();
              router.push("/admin/connexion");
            }}
            className="flex items-center gap-1 text-sm hover:underline"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Déconnexion
          </button>
        </header>
        <main id="contenu" tabIndex={-1} className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
