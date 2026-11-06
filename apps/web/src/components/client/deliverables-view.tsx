"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth/session";
import { useAsync } from "@/lib/hooks/use-async";
import { listDeliverables, markDeliverableSeen } from "@/lib/services";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { DateLabel, EmptyState, ErrorState, LoadingState } from "@/components/shared";

type Filter = "all" | "pdf" | "xlsx";

export function DeliverablesView() {
  const { session } = useSession();
  const clientId = session?.role === "client" ? session.clientId : "";
  const items = useAsync(() => listDeliverables(clientId), [clientId]);
  const [filter, setFilter] = useState<Filter>("all");

  if (items.status === "loading") return <LoadingState />;
  if (items.status === "error") return <ErrorState message="Livrables indisponibles." onRetry={items.reload} />;

  const shown = [...items.data]
    .filter((d) => filter === "all" || d.fileType === filter)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Filtrer par type" className="flex gap-2">
        {([["all", "Tous"], ["pdf", "PDF"], ["xlsx", "Excel"]] as const).map(([v, label]) => (
          <button
            key={v}
            aria-pressed={filter === v}
            onClick={() => setFilter(v)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === v ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState message="Aucun livrable pour le moment." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {shown.map((d) => {
            const Icon = d.fileType === "pdf" ? FileText : FileSpreadsheet;
            return (
              <li key={d.id} className="flex items-start gap-3 rounded-lg border border-border p-4">
                <Icon className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-primary">
                    {d.title}{" "}
                    {d.isNew && <span className="ml-1 rounded-full bg-accent px-2 py-0.5 align-middle text-xs text-accent-foreground">Nouveau</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.fileType.toUpperCase()} · {d.sizeKb} Ko · <DateLabel value={d.publishedAt} />
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={async () => {
                      toast.info("Téléchargement disponible dans la version finale");
                      if (d.isNew) {
                        await markDeliverableSeen(d.id);
                        items.reload();
                      }
                    }}
                  >
                    <Download className="h-4 w-4" aria-hidden /> Télécharger
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
