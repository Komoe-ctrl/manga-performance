"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Calendar, FileText, Mail, Phone, StickyNote, Users } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import {
  addFollowUp,
  addInteraction,
  completeFollowUp,
  getProspect,
  invoiceTotals,
  listFollowUps,
  listInteractions,
  listInvoices,
  updateProspectStatus,
} from "@/lib/services";
import { NEED_LABELS, SOURCE_LABELS, STATUS_LABELS, STATUS_ORDER } from "@/lib/constants";
import type { InteractionType } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { DateLabel, EmptyState, ErrorState, LoadingState, MoneyAmount, PageHeader, StatusBadge } from "@/components/shared";

const ICONS = { email: Mail, appel: Phone, reunion: Users, note: StickyNote } as const;
const TYPE_LABELS: Record<InteractionType, string> = { email: "Email", appel: "Appel", reunion: "Réunion", note: "Note" };

function History({ prospectId }: { prospectId: string }) {
  const items = useAsync(() => listInteractions(prospectId));
  const [type, setType] = useState<InteractionType>("note");
  const [summary, setSummary] = useState("");

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!summary.trim()) return;
          await addInteraction({ prospectId, type, summary: summary.trim(), date: new Date().toISOString() });
          setSummary("");
          items.reload();
        }}
      >
        <Field label="Type" htmlFor="int-type">
          <Select id="int-type" value={type} onChange={(e) => setType(e.target.value as InteractionType)}>
            {(Object.keys(TYPE_LABELS) as InteractionType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <div className="min-w-60 flex-1">
          <Field label="Résumé" htmlFor="int-summary">
            <Input id="int-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
        </div>
        <Button type="submit">Ajouter</Button>
      </form>
      {items.status === "loading" && <LoadingState />}
      {items.status === "error" && <ErrorState message="Historique indisponible." onRetry={items.reload} />}
      {items.status === "success" &&
        (items.data.length === 0 ? (
          <EmptyState message="Aucune interaction enregistrée." />
        ) : (
          <ol className="space-y-3 border-l-2 border-border pl-4">
            {[...items.data].sort((a, b) => b.date.localeCompare(a.date)).map((i) => {
              const Icon = ICONS[i.type];
              return (
                <li key={i.id} className="relative text-sm">
                  <Icon className="absolute -left-[26px] top-0.5 h-4 w-4 rounded-full bg-background text-warning" aria-hidden />
                  <p className="font-medium">{TYPE_LABELS[i.type]} · <DateLabel value={i.date} /></p>
                  <p className="text-muted-foreground">{i.summary}</p>
                </li>
              );
            })}
          </ol>
        ))}
    </div>
  );
}

function FollowUps({ prospectId }: { prospectId: string }) {
  const all = useAsync(listFollowUps);
  const [due, setDue] = useState("");

  if (all.status === "loading") return <LoadingState />;
  if (all.status === "error") return <ErrorState message="Relances indisponibles." onRetry={all.reload} />;
  const mine = all.data.filter((f) => f.prospectId === prospectId);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!due) return;
          await addFollowUp({ prospectId, dueAt: new Date(due).toISOString(), rule: "manuel" });
          setDue("");
          all.reload();
        }}
      >
        <Field label="Nouvelle relance" htmlFor="fu-date">
          <Input id="fu-date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Button type="submit">Ajouter</Button>
      </form>
      {mine.length === 0 ? (
        <EmptyState message="Aucune relance planifiée." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {mine.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 p-3">
              <span className={cn(f.done && "text-muted-foreground line-through")}>
                {f.rule} · <DateLabel value={f.dueAt} />
              </span>
              {f.done ? (
                <span className="text-xs text-success">Faite</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await completeFollowUp(f.id);
                    toast.success("Relance marquée comme faite");
                    all.reload();
                  }}
                >
                  Marquer comme faite
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProspectInvoices({ clientId }: { clientId: string }) {
  const invoices = useAsync(listInvoices);
  if (invoices.status === "loading") return <LoadingState />;
  if (invoices.status === "error") return <ErrorState message="Factures indisponibles." onRetry={invoices.reload} />;
  const mine = invoices.data.filter((i) => i.clientId === clientId);
  if (mine.length === 0) return <EmptyState message="Aucune facture pour ce client." />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
      {mine.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <Link href={`/admin/factures/${i.id}`} className="font-medium hover:underline">
            <FileText className="mr-1 inline h-4 w-4" aria-hidden />
            {i.number}
          </Link>
          <MoneyAmount value={invoiceTotals(i).ttc} />
          <StatusBadge status={i.status} />
        </li>
      ))}
    </ul>
  );
}

export function ProspectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const prospect = useAsync(() => getProspect(id));
  const [tab, setTab] = useState<"historique" | "relances" | "factures">("historique");

  if (prospect.status === "loading") return <LoadingState />;
  if (prospect.status === "error") return <ErrorState message="Fiche indisponible." onRetry={prospect.reload} />;
  const p = prospect.data;
  if (!p) return <EmptyState message="Prospect introuvable." />;

  const tabs = [
    ["historique", "Historique", Calendar],
    ["relances", "Relances", Calendar],
    ...(p.status === "client" ? ([["factures", "Factures", FileText]] as const) : []),
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.companyName}
        description={`${p.contactName} · ${p.sector} · ${p.city}`}
        actions={
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{SOURCE_LABELS[p.source]}</span>
            <label className="text-sm">
              <span className="sr-only">Statut</span>
              <Select
                value={p.status}
                onChange={async (e) => {
                  const status = e.target.value as typeof p.status;
                  await updateProspectStatus(p.id, status, { createAccess: status === "client" });
                  toast.success(`Statut : ${STATUS_LABELS[status]}`);
                  prospect.reload();
                }}
              >
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </Select>
            </label>
          </div>
        }
      />
      <dl className="grid gap-3 rounded-lg border border-border p-4 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Email</dt><dd>{p.email ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">Téléphone</dt><dd>{p.phone ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">Besoin</dt><dd>{NEED_LABELS[p.need]}</dd></div>
        <div><dt className="text-muted-foreground">Valeur estimée</dt><dd>{p.estimatedValue ? <MoneyAmount value={p.estimatedValue} /> : "—"}</dd></div>
        <div><dt className="text-muted-foreground">Créé le</dt><dd><DateLabel value={p.createdAt} /></dd></div>
        <div><dt className="text-muted-foreground">Note</dt><dd>{p.ownerNote ?? "—"}</dd></div>
      </dl>

      <div>
        <div role="tablist" aria-label="Sections de la fiche" className="mb-4 flex gap-1 border-b border-border">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn("px-4 py-2 text-sm", tab === key ? "border-b-2 border-accent font-semibold text-primary" : "text-muted-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === "historique" && <History prospectId={p.id} />}
          {tab === "relances" && <FollowUps prospectId={p.id} />}
          {tab === "factures" && p.status === "client" && <ProspectInvoices clientId={p.id} />}
        </div>
      </div>
    </div>
  );
}
