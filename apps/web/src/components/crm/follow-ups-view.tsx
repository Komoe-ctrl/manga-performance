"use client";

import { useState } from "react";
import Link from "next/link";
import { differenceInCalendarDays, isSameDay, parseISO } from "date-fns";
import { CalendarClock, Check, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { completeFollowUp, listFollowUps, listProspects } from "@/lib/services";
import { REFERENCE_DATE } from "@/lib/constants";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { DateLabel, ErrorState, LoadingState } from "@/components/shared";

type Tone = "danger" | "accent" | "neutral";

const TONES: Record<Tone, { count: string; row: string }> = {
  danger: { count: "bg-danger/10 text-danger", row: "border-l-4 border-l-danger" },
  accent: { count: "bg-accent/30 text-accent-foreground", row: "border-l-4 border-l-accent" },
  neutral: { count: "bg-muted text-muted-foreground", row: "border-l-4 border-l-transparent" },
};

export function FollowUpsView() {
  const data = useAsync(async () => ({ followUps: await listFollowUps(), prospects: await listProspects() }));
  const [pending, setPending] = useState<string | null>(null);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Relances indisponibles." onRetry={data.reload} />;

  const today = parseISO(REFERENCE_DATE);
  const names = new Map(data.data.prospects.map((p) => [p.id, p.companyName]));
  const open = data.data.followUps.filter((f) => !f.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const groups: { title: string; tone: Tone; empty: string; items: typeof open }[] = [
    { title: "En retard", tone: "danger", empty: "Aucune relance en retard.", items: open.filter((f) => !isSameDay(parseISO(f.dueAt), today) && parseISO(f.dueAt) < today) },
    { title: "Aujourd'hui", tone: "accent", empty: "Rien de prévu aujourd'hui.", items: open.filter((f) => isSameDay(parseISO(f.dueAt), today)) },
    { title: "À venir", tone: "neutral", empty: "Aucune relance planifiée.", items: open.filter((f) => !isSameDay(parseISO(f.dueAt), today) && parseISO(f.dueAt) > today) },
  ];

  const delay = (dueAt: string) => {
    const days = differenceInCalendarDays(today, parseISO(dueAt));
    if (days > 0) return { text: `${days} jour${days > 1 ? "s" : ""} de retard`, className: "text-danger font-medium" };
    if (days === 0) return { text: "Aujourd'hui", className: "font-medium text-primary" };
    return { text: `dans ${-days} jour${days < -1 ? "s" : ""}`, className: "text-muted-foreground" };
  };

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.title} aria-labelledby={`fu-${g.tone}`}>
          <h2 id={`fu-${g.tone}`} className="mb-2 flex items-center gap-2 font-bold text-primary">
            {g.title}
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TONES[g.tone].count)}>{g.items.length}</span>
          </h2>
          {g.items.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {g.tone !== "neutral" && <PartyPopper className="h-4 w-4 text-success" aria-hidden />} {g.empty}
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border text-sm">
              {g.items.map((f) => {
                const d = delay(f.dueAt);
                return (
                  <li
                    key={f.id}
                    className={cn("grid items-center gap-x-4 gap-y-1 p-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_9rem_12rem_auto]", TONES[g.tone].row)}
                  >
                    <Link href={`/admin/prospects/${f.prospectId}`} className="truncate font-medium text-primary hover:underline">
                      {names.get(f.prospectId)}
                    </Link>
                    <span className="w-fit rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {f.rule === "manuel" ? "Manuelle" : `Relance ${f.rule}`}
                    </span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        <DateLabel value={f.dueAt} /> <span className={cn("block text-xs", d.className)}>{d.text}</span>
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="success"
                      loading={pending === f.id}
                      aria-label={`Marquer la relance de ${names.get(f.prospectId)} comme faite`}
                      onClick={async () => {
                        setPending(f.id);
                        try {
                          await completeFollowUp(f.id);
                          toast.success("Relance faite");
                          data.reload();
                        } finally {
                          setPending(null);
                        }
                      }}
                    >
                      {pending !== f.id && <Check className="h-4 w-4" aria-hidden />} Fait
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
