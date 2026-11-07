"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarClock, GripVertical, Inbox } from "lucide-react";
import { toast } from "sonner";
import { updateProspectStatus } from "@/lib/services";
import { SOURCE_LABELS, STATUS_LABELS, STATUS_ORDER } from "@/lib/constants";
import type { Prospect, ProspectStatus } from "@/lib/types";
import { formatFCFA } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

/** One tone per stage: a coloured edge makes the board readable at a glance. */
const STAGE: Record<ProspectStatus, { edge: string; badge: string; hint: string }> = {
  nouveau: { edge: "border-t-slate-400", badge: "bg-slate-200 text-slate-700", hint: "Aucun nouveau prospect" },
  en_negociation: { edge: "border-t-accent", badge: "bg-accent/30 text-accent-foreground", hint: "Aucune négociation en cours" },
  client: { edge: "border-t-success", badge: "bg-success/15 text-success", hint: "Aucun client pour l'instant" },
  perdu: { edge: "border-t-danger", badge: "bg-danger/10 text-danger", hint: "Aucun prospect perdu" },
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

function CardBody({ prospect, handle, onMove }: { prospect: Prospect; handle?: React.ReactNode; onMove?: (id: string, s: ProspectStatus) => void }) {
  return (
    <>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary" aria-hidden>
          {initials(prospect.companyName)}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/admin/prospects/${prospect.id}`} className="block truncate font-medium text-primary hover:underline">
            {prospect.companyName}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{prospect.contactName}</p>
        </div>
        {handle}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{SOURCE_LABELS[prospect.source]}</span>
        {prospect.estimatedValue !== undefined && <span className="font-semibold text-primary">{formatFCFA(prospect.estimatedValue)}</span>}
      </div>

      {prospect.nextFollowUpAt && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          Relance le {format(parseISO(prospect.nextFollowUpAt), "d MMM", { locale: fr })}
        </p>
      )}

      {onMove && (
        <label className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="shrink-0">Déplacer vers</span>
          <select
            aria-label={`Statut de ${prospect.companyName}`}
            className="h-7 min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-background px-1.5 text-xs text-foreground hover:border-primary/40"
            value={prospect.status}
            onChange={(e) => onMove(prospect.id, e.target.value as ProspectStatus)}
          >
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

function Card({ prospect, onMove }: { prospect: Prospect; onMove: (id: string, s: ProspectStatus) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: prospect.id });
  return (
    <li
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-border bg-background p-3 text-sm shadow-sm transition-shadow hover:shadow-md",
        // The card being dragged is shown by the overlay; this one stays behind as a ghost.
        isDragging && "opacity-40",
      )}
    >
      <CardBody
        prospect={prospect}
        onMove={onMove}
        handle={
          // Poignée : glisser à la souris, ou Espace + flèches au clavier
          <button
            {...attributes}
            {...listeners}
            aria-label={`Déplacer ${prospect.companyName}`}
            className="-mr-1 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        }
      />
    </li>
  );
}

function Column({ status, items, onMove }: { status: ProspectStatus; items: Prospect[]; onMove: (id: string, s: ProspectStatus) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const total = items.reduce((sum, p) => sum + (p.estimatedValue ?? 0), 0);
  const tone = STAGE[status];
  return (
    <section
      ref={setNodeRef}
      aria-label={STATUS_LABELS[status]}
      className={cn("flex flex-col rounded-lg border-t-4 bg-muted/70 p-3 transition-shadow", tone.edge, isOver && "ring-2 ring-accent ring-offset-2")}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
          {STATUS_LABELS[status]}
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tone.badge)}>{items.length}</span>
        </h3>
        {total > 0 && <span className="text-xs font-medium text-muted-foreground">{formatFCFA(total)}</span>}
      </header>
      {/* `relative` : the list clips its own scrolling content, including visually hidden labels. */}
      <ul className="relative max-h-[calc(100vh-22rem)] min-h-40 flex-1 space-y-2 overflow-y-auto pr-1">
        {items.map((p) => <Card key={p.id} prospect={p} onMove={onMove} />)}
        {items.length === 0 && (
          <li className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center text-xs text-muted-foreground">
            <Inbox className="h-5 w-5" aria-hidden />
            {tone.hint}
            <span>Déposez une carte ici</span>
          </li>
        )}
      </ul>
    </section>
  );
}

export function Kanban({ prospects, onChanged }: { prospects: Prospect[]; onChanged: () => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [pendingClient, setPendingClient] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const apply = async (id: string, status: ProspectStatus, createAccess = false) => {
    await updateProspectStatus(id, status, { createAccess });
    toast.success(`Statut : ${STATUS_LABELS[status]}`);
    onChanged();
  };
  const move = (id: string, status: ProspectStatus) => {
    const p = prospects.find((x) => x.id === id);
    if (!p || p.status === status) return;
    if (status === "client") setPendingClient(id);
    else void apply(id, status);
  };
  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over) move(String(e.active.id), e.over.id as ProspectStatus);
  };
  const pending = prospects.find((p) => p.id === pendingClient);
  const active = prospects.find((p) => p.id === activeId);

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUS_ORDER.map((s) => (
            <Column key={s} status={s} items={prospects.filter((p) => p.status === s)} onMove={move} />
          ))}
        </div>
        {/* Rendered above everything: a dragged card is never clipped by its column. */}
        <DragOverlay>
          {active ? (
            <div className="rotate-1 cursor-grabbing rounded-lg border border-accent bg-background p-3 text-sm shadow-xl">
              <CardBody prospect={active} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {pending && (
        <div role="alertdialog" aria-labelledby="client-confirm" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-background p-6">
            <h2 id="client-confirm" className="font-bold text-primary">
              {pending.companyName} devient client
            </h2>
            <p className="mt-2 text-sm">Créer aussi son accès à l&apos;espace client ?</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingClient(null)}>Annuler</Button>
              <Button variant="outline" onClick={() => { void apply(pending.id, "client", false); setPendingClient(null); }}>
                Non, plus tard
              </Button>
              <Button variant="accent" onClick={() => { void apply(pending.id, "client", true); setPendingClient(null); }}>
                Oui, créer l&apos;accès
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
