"use client";

import { useState } from "react";
import { MailPlus, Pause, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import {
  assignContributor,
  createCollectionEntity,
  createCollectionPlan,
  inviteCollectionUser,
  listCollectionEntities,
  listCollectionPeople,
  setCollectionPlanActive,
  unassignContributor,
  VIEWER_ROLE_LABELS,
  type CollectionPerson,
} from "@/lib/services/collection";
import { collectionTemplates } from "@/lib/mock/collection";
import { SECTOR_LABELS, type Sector } from "@/lib/types/collection";
import { formatDate } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

const failure = (error: unknown, fallback: string) => toast.error(error instanceof Error ? error.message : fallback);
const firstOfMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** Entités, plans de collecte, comptes et affectations des contributeurs (avenant §3, §6 et §10). */
export function EntitiesView() {
  const [version, setVersion] = useState(0);
  const data = useAsync(listCollectionEntities, [version]);
  const people = useAsync(listCollectionPeople, [version]);
  const refresh = () => setVersion((v) => v + 1);

  if (data.status === "loading" || people.status === "loading") return <LoadingState />;
  if (data.status === "error" || people.status === "error") return <ErrorState message="Entités indisponibles." onRetry={() => { data.reload(); people.reload(); }} />;
  const { entities, plans, clients } = data.data;
  const { users, assignments } = people.data;

  return (
    <div className="space-y-8">
      <EntityForm clients={clients} onDone={refresh} />
      <PlanForm entities={entities} onDone={refresh} />
      <InviteForm clients={clients} onDone={refresh} />

      {clients.map((c) => {
        const list = entities.filter((e) => e.clientId === c.id);
        const accounts = users.filter((u) => u.clientId === c.id);
        return (
          <section key={c.id} aria-label={c.name} className="space-y-3">
            <h2 className="font-semibold text-primary">{c.name}</h2>
            {list.length === 0 ? (
              <EmptyState message="Aucune entité pour ce client." />
            ) : (
              <div className="relative overflow-x-auto rounded-xl border border-border bg-background">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2">Entité</th>
                      <th scope="col" className="px-3 py-2">Secteur</th>
                      <th scope="col" className="px-3 py-2">Plans de collecte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => (
                      <tr key={e.id} className="border-t border-border align-top">
                        <th scope="row" className="px-3 py-2 text-left font-semibold text-primary">{e.name}</th>
                        <td className="px-3 py-2">{SECTOR_LABELS[e.sector]}</td>
                        <td className="space-y-1 px-3 py-2">
                          {plans.filter((p) => p.entityId === e.id).map((p) => (
                            <p key={p.id} className="flex flex-wrap items-center gap-2">
                              <span>
                                {collectionTemplates.find((t) => t.id === p.templateId)?.label}
                                <span className="text-muted-foreground"> · {p.frequency === "MENSUELLE" ? "mensuelle" : "hebdomadaire"} · J+{p.delayDays} · depuis le {formatDate(p.startsOn)}</span>
                              </span>
                              {!p.active && <span className="rounded bg-muted px-1.5 text-xs font-medium">Suspendu</span>}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`${p.active ? "Suspendre" : "Reprendre"} le plan ${collectionTemplates.find((t) => t.id === p.templateId)?.label} de ${e.name}`}
                                onClick={async () => {
                                  try {
                                    await setCollectionPlanActive(p.id, !p.active);
                                    refresh();
                                  } catch (error) {
                                    failure(error, "Action impossible.");
                                  }
                                }}
                              >
                                {p.active ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                              </Button>
                            </p>
                          ))}
                          {plans.every((p) => p.entityId !== e.id) && <span className="text-muted-foreground">Aucun plan</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {accounts.length > 0 && (
              <div className="relative overflow-x-auto rounded-xl border border-border bg-background">
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">Comptes de {c.name} et entités affectées</caption>
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2">Compte</th>
                      <th scope="col" className="px-3 py-2">Rôle</th>
                      <th scope="col" className="px-3 py-2">Entités affectées</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((u) => (
                      <tr key={u.id} className="border-t border-border align-top">
                        <th scope="row" className="px-3 py-2 text-left font-normal">
                          <p className="font-semibold text-primary">{u.name}</p>
                          <p className="text-xs text-muted-foreground">{u.email}{!u.active && " · désactivé"}</p>
                        </th>
                        <td className="px-3 py-2">{VIEWER_ROLE_LABELS[u.role]}</td>
                        <td className="px-3 py-2">
                          {u.role === "CLIENT_CONTRIBUTEUR" ? (
                            <Assignments user={u} entities={list} assigned={assignments.filter((a) => a.userId === u.id).map((a) => a.entityId)} onChanged={refresh} />
                          ) : (
                            <span className="text-muted-foreground">Toutes les entités du client</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Assignments({ user, entities, assigned, onChanged }: { user: CollectionPerson; entities: { id: string; name: string }[]; assigned: string[]; onChanged: () => void }) {
  if (entities.length === 0) return <span className="text-muted-foreground">Aucune entité</span>;
  return (
    <ul className="space-y-1">
      {entities.map((e) => (
        <li key={e.id}>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={assigned.includes(e.id)}
              aria-label={`${user.name} : ${e.name}`}
              onChange={async (event) => {
                try {
                  if (event.target.checked) await assignContributor(e.id, user.id);
                  else await unassignContributor(e.id, user.id);
                  onChanged();
                } catch (error) {
                  failure(error, "Affectation impossible.");
                }
              }}
            />
            {e.name}
          </label>
        </li>
      ))}
    </ul>
  );
}

function EntityForm({ clients, onDone }: { clients: { id: string; name: string }[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [sector, setSector] = useState<Sector>("HOTELLERIE");
  const [busy, setBusy] = useState(false);
  const targetClient = clientId || clients[0]?.id || "";

  return (
    <form
      aria-label="Nouvelle entité"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-background p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await createCollectionEntity({ clientId: targetClient, name, sector });
          toast.success("Entité créée. Ajoutez maintenant un plan de collecte.");
          setName("");
          onDone();
        } catch (error) {
          failure(error, "Création impossible.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Client" htmlFor="ent-client">
        <Select id="ent-client" value={targetClient} onChange={(e) => setClientId(e.target.value)}>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Nom de l'entité (hôtel, site, chantier…)" htmlFor="ent-name">
        <Input id="ent-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Secteur" htmlFor="ent-sector">
        <Select id="ent-sector" value={sector} onChange={(e) => setSector(e.target.value as Sector)}>
          {(Object.keys(SECTOR_LABELS) as Sector[]).map((s) => <option key={s} value={s}>{SECTOR_LABELS[s]}</option>)}
        </Select>
      </Field>
      <Button type="submit" variant="accent" loading={busy} disabled={name.trim().length < 2 || !targetClient}>
        <Plus className="h-4 w-4" aria-hidden /> Créer l&apos;entité
      </Button>
    </form>
  );
}

function PlanForm({ entities, onDone }: { entities: { id: string; name: string; sector: Sector }[]; onDone: () => void }) {
  const [entityId, setEntityId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [frequency, setFrequency] = useState<"MENSUELLE" | "HEBDOMADAIRE">("MENSUELLE");
  const [delayDays, setDelayDays] = useState(3);
  const [startsOn, setStartsOn] = useState(firstOfMonth());
  const [busy, setBusy] = useState(false);

  const entity = entities.find((e) => e.id === entityId) ?? entities[0];
  const templates = entity ? collectionTemplates.filter((t) => t.sector === entity.sector) : [];
  const template = templates.find((t) => t.id === templateId) ?? templates[0];

  if (entities.length === 0) return null;
  return (
    <form
      aria-label="Nouveau plan de collecte"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-background p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!entity || !template) return;
        setBusy(true);
        try {
          await createCollectionPlan({ entityId: entity.id, templateId: template.id, frequency, delayDays, startsOn });
          toast.success("Plan de collecte créé.");
          onDone();
        } catch (error) {
          failure(error, "Création impossible.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Entité" htmlFor="plan-entity">
        <Select id="plan-entity" value={entity?.id} onChange={(e) => { setEntityId(e.target.value); setTemplateId(""); }}>
          {entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      </Field>
      <Field label="Modèle" htmlFor="plan-template">
        <Select id="plan-template" value={template?.id ?? ""} onChange={(e) => setTemplateId(e.target.value)}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
      </Field>
      <Field label="Fréquence" htmlFor="plan-frequency">
        <Select id="plan-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
          <option value="MENSUELLE">Mensuelle</option>
          <option value="HEBDOMADAIRE">Hebdomadaire</option>
        </Select>
      </Field>
      <Field label="Délai (jours après la période)" htmlFor="plan-delay">
        <Input id="plan-delay" type="number" min={0} max={30} value={delayDays} onChange={(e) => setDelayDays(Number(e.target.value))} />
      </Field>
      <Field label="Début de la collecte" htmlFor="plan-starts">
        <Input id="plan-starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
      </Field>
      <Button type="submit" variant="accent" loading={busy} disabled={!template}>
        <Plus className="h-4 w-4" aria-hidden /> Créer le plan
      </Button>
    </form>
  );
}

function InviteForm({ clients, onDone }: { clients: { id: string; name: string }[]; onDone: () => void }) {
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CollectionPerson["role"]>("CLIENT_CONTRIBUTEUR");
  const [busy, setBusy] = useState(false);
  const target = clientId || clients[0]?.id || "";
  if (clients.length === 0) return null;

  return (
    <form
      aria-label="Inviter un compte"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-background p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await inviteCollectionUser({ clientId: target, name, email, role });
          toast.success("Invitation envoyée.");
          setName("");
          setEmail("");
          onDone();
        } catch (error) {
          failure(error, "Invitation impossible.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Client" htmlFor="inv-client">
        <Select id="inv-client" value={target} onChange={(e) => setClientId(e.target.value)}>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Nom" htmlFor="inv-name">
        <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email" htmlFor="inv-email">
        <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Rôle" htmlFor="inv-role">
        <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {(Object.keys(VIEWER_ROLE_LABELS) as CollectionPerson["role"][]).map((r) => <option key={r} value={r}>{VIEWER_ROLE_LABELS[r]}</option>)}
        </Select>
      </Field>
      <Button type="submit" variant="accent" loading={busy} disabled={name.trim().length < 1 || !email.includes("@")}>
        <MailPlus className="h-4 w-4" aria-hidden /> Inviter
      </Button>
    </form>
  );
}
