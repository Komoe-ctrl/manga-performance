"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { clientNav } from "@/lib/nav";
import { useSession } from "@/lib/auth/session";
import { useAsync } from "@/lib/hooks/use-async";
import { getProspect, listNotifications } from "@/lib/services";
import { cn } from "@/lib/utils/cn";

export function ClientShell({ children }: { children: React.ReactNode }) {
  const { session, ready, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const clientId = session?.role === "client" ? session.clientId : null;
  const client = useAsync(() => (clientId ? getProspect(clientId) : Promise.resolve(null)));
  const notifications = useAsync(() => (clientId ? listNotifications(clientId) : Promise.resolve([])), [clientId, pathname]);
  const unread = notifications.status === "success" ? notifications.data.length : 0;

  useEffect(() => {
    if (ready && !clientId) router.replace("/espace-client/connexion");
  }, [ready, clientId, router]);

  if (!ready || !clientId) {
    return <p className="p-8 text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="font-heading font-extrabold">MANGA PERFORMANCE</span>
          <div className="flex items-center gap-4 text-sm">
            <span>{client.status === "success" ? client.data?.companyName : "…"}</span>
            <button
              onClick={() => {
                signOut();
                router.push("/espace-client/connexion");
              }}
              className="flex items-center gap-1 hover:underline"
            >
              <LogOut className="h-4 w-4" aria-hidden /> Déconnexion
            </button>
          </div>
        </div>
        <nav aria-label="Navigation espace client" className="mx-auto flex max-w-5xl gap-1 px-4">
          {clientNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={cn(
                "rounded-t-md px-4 py-2 text-sm",
                pathname === item.href ? "bg-background text-primary" : "hover:bg-white/10",
              )}
            >
              {item.label}
              {item.href.endsWith("/notifications") && unread > 0 && (
                <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
                  {unread}
                  <span className="sr-only"> non lues</span>
                </span>
              )}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
