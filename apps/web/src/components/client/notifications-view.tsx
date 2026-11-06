"use client";

import Link from "next/link";
import { FileText, MessageSquare } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { useAsync } from "@/lib/hooks/use-async";
import { listNotifications } from "@/lib/services";
import { DateLabel, EmptyState, ErrorState, LoadingState } from "@/components/shared";

export function NotificationsView() {
  const { session } = useSession();
  const clientId = session?.role === "client" ? session.clientId : "";
  const items = useAsync(() => listNotifications(clientId), [clientId]);

  if (items.status === "loading") return <LoadingState />;
  if (items.status === "error") return <ErrorState message="Notifications indisponibles." onRetry={items.reload} />;
  if (items.data.length === 0) return <EmptyState message="Aucune nouvelle notification." />;

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {items.data.map((n) => {
        const Icon = n.kind === "livrable" ? FileText : MessageSquare;
        return (
          <li key={n.id}>
            <Link href={n.href} className="flex items-center gap-3 p-3 text-sm hover:bg-muted">
              <Icon className="h-5 w-5 shrink-0 text-warning" aria-hidden />
              <span className="flex-1">{n.title}</span>
              <span className="text-xs text-muted-foreground"><DateLabel value={n.at} /></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
