"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { createCollectionEntity, listCollectionEntities } from "@/lib/services/collection";
import { collectionTemplates } from "@/lib/mock/collection";
import { SECTOR_LABELS, type Sector } from "@/lib/types/collection";
import { formatDate } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

export function EntitiesView() {
  const [version, setVersion] = useState(0);
  const data = useAsync(listCollectionEntities, [version]);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [sector, setSector] = useState<Sector>("HOTELLERIE");
  const [busy, setBusy] = useState(false);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Entités indisponibles." onRetry={data.reload} />;
  const { entities, plans, clients } = data.data;
  const targetClient = clientId || clients[0]?.id;

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-background p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await createCollectionEntity({ clientId: targetClient, name, sector });
            toast.success("Entité créée. Ajoutez maintenant un plan de collecte.");
            setName("");
            setVersion((v) => v + 1);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Création impossible.");
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
        <Button type="submit" variant="accent" loading={busy} disabled={name.trim().length < 2}>
          <Plus className="h-4 w-4" aria-hidden /> Créer l&apos;entité
        </Button>
      </form>

      {clients.map((c) => {
        const list = entities.filter((e) => e.clientId === c.id);
        return (
          <section key={c.id} aria-label={c.name} className="space-y-2">
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
                        <td className="px-3 py-2">
                          {plans.filter((p) => p.entityId === e.id).map((p) => (
                            <p key={p.id}>
                              {collectionTemplates.find((t) => t.id === p.templateId)?.label}
                              <span className="text-muted-foreground"> · {p.frequency === "MENSUELLE" ? "mensuelle" : "hebdomadaire"} · J+{p.delayDays} · depuis le {formatDate(p.startsOn)}</span>
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
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">L&apos;ajout d&apos;un plan, l&apos;affectation des contributeurs et les invitations arrivent avec le branchement base de données (étape B1).</p>
    </div>
  );
}
