"use client";

import Link from "next/link";
import { isSameDay, parseISO } from "date-fns";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { completeFollowUp, listFollowUps, listProspects } from "@/lib/services";
import { REFERENCE_DATE } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { DateLabel, EmptyState, ErrorState, LoadingState } from "@/components/shared";

export function FollowUpsView() {
  const data = useAsync(async () => ({ followUps: await listFollowUps(), prospects: await listProspects() }));

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Relances indisponibles." onRetry={data.reload} />;

  const today = parseISO(REFERENCE_DATE);
  const names = new Map(data.data.prospects.map((p) => [p.id, p.companyName]));
  const open = data.data.followUps.filter((f) => !f.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const groups = [
    { title: "En retard", items: open.filter((f) => !isSameDay(parseISO(f.dueAt), today) && parseISO(f.dueAt) < today) },
    { title: "Aujourd'hui", items: open.filter((f) => isSameDay(parseISO(f.dueAt), today)) },
    { title: "À venir", items: open.filter((f) => !isSameDay(parseISO(f.dueAt), today) && parseISO(f.dueAt) > today) },
  ];

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h2 className="mb-2 font-bold text-primary">
            {g.title} <span className="font-normal text-muted-foreground">({g.items.length})</span>
          </h2>
          {g.items.length === 0 ? (
            <EmptyState message="Rien ici." />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {g.items.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <Link href={`/admin/prospects/${f.prospectId}`} className="font-medium hover:underline">
                    {names.get(f.prospectId)}
                  </Link>
                  <span className="text-muted-foreground">
                    {f.rule} · <DateLabel value={f.dueAt} />
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await completeFollowUp(f.id);
                      toast.success("Relance faite");
                      data.reload();
                    }}
                  >
                    Fait
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
