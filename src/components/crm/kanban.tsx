"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { updateProspectStatus } from "@/lib/services";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/constants";
import type { Prospect, ProspectStatus } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { MoneyAmount } from "@/components/shared";

function Card({ prospect, onMove }: { prospect: Prospect; onMove: (id: string, s: ProspectStatus) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: prospect.id });
  return (
    <li
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn("rounded-md border border-border bg-background p-3 text-sm shadow-sm", isDragging && "z-10 opacity-80 shadow-lg")}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/admin/prospects/${prospect.id}`} className="font-medium hover:underline">
          {prospect.companyName}
        </Link>
        {/* Poignée : glisser à la souris, ou Espace + flèches au clavier */}
        <button
          {...attributes}
          {...listeners}
          aria-label={`Déplacer ${prospect.companyName}`}
          className="cursor-grab rounded px-1 text-muted-foreground hover:bg-muted"
        >
          ⠿
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{prospect.contactName}</p>
      {prospect.estimatedValue !== undefined && (
        <p className="mt-1 text-xs"><MoneyAmount value={prospect.estimatedValue} /></p>
      )}
      <label className="mt-2 block text-xs">
        <span className="sr-only">Statut de {prospect.companyName}</span>
        <Select
          className="h-8 text-xs"
          value={prospect.status}
          onChange={(e) => onMove(prospect.id, e.target.value as ProspectStatus)}
        >
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
      </label>
    </li>
  );
}

function Column({ status, items, onMove }: { status: ProspectStatus; items: Prospect[]; onMove: (id: string, s: ProspectStatus) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={STATUS_LABELS[status]}
      className={cn("flex min-h-40 flex-col rounded-lg bg-muted p-3", isOver && "ring-2 ring-accent")}
    >
      <h3 className="mb-2 text-sm font-bold text-primary">
        {STATUS_LABELS[status]} <span className="font-normal text-muted-foreground">({items.length})</span>
      </h3>
      <ul className="max-h-[60vh] flex-1 space-y-2 overflow-y-auto">
        {items.map((p) => <Card key={p.id} prospect={p} onMove={onMove} />)}
      </ul>
    </section>
  );
}

export function Kanban({ prospects, onChanged }: { prospects: Prospect[]; onChanged: () => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [pendingClient, setPendingClient] = useState<string | null>(null);

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
  const onDragEnd = (e: DragEndEvent) => {
    if (e.over) move(String(e.active.id), e.over.id as ProspectStatus);
  };
  const pending = prospects.find((p) => p.id === pendingClient);

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUS_ORDER.map((s) => (
            <Column key={s} status={s} items={prospects.filter((p) => p.status === s)} onMove={move} />
          ))}
        </div>
      </DndContext>

      {pending && (
        <div role="alertdialog" aria-labelledby="client-confirm" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-background p-6">
            <h2 id="client-confirm" className="font-bold text-primary">
              {pending.companyName} devient client
            </h2>
            <p className="mt-2 text-sm">Créer aussi son accès à l&apos;espace client ?</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingClient(null)}>Annuler</Button>
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
