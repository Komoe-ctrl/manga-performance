"use client";

import { useState } from "react";
import { AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import { pilotHotels, type PilotParams } from "@/lib/mock/pilot";
import { getPilotParams, savePilotParams } from "@/lib/services/pilot";
import { useAsync } from "@/lib/hooks/use-async";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";
import { formatDate } from "@/lib/utils/format";

const hotelName = (id: string | null) => (id === null ? "Défaut du client" : (pilotHotels.find((h) => h.id === id)?.name ?? id));

/** Paramètres CPRA du client (avenant §10) : produits, conversions, normes datées, coûts, facteur long séjour. */
export function CpraSettings({ onSaved }: { onSaved: () => void }) {
  const loaded = useAsync(getPilotParams);
  if (loaded.status === "loading") return <LoadingState />;
  if (loaded.status === "error") return <ErrorState message="Paramètres indisponibles." onRetry={loaded.reload} />;
  return <Form initial={loaded.data} onSaved={onSaved} />;
}

function Form({ initial, onSaved }: { initial: PilotParams; onSaved: () => void }) {
  const [params, setParams] = useState<PilotParams>(structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const missing = params.conversions.filter((c) => c.factor === null);

  const patch = (mutate: (draft: PilotParams) => void) =>
    setParams((current) => {
      const next = structuredClone(current);
      mutate(next);
      return next;
    });

  return (
    <form
      className="space-y-8"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await savePilotParams(params);
          toast.success("Paramètres enregistrés. Lancez un recalcul pour les appliquer aux résultats.");
          onSaved();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Enregistrement impossible.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {missing.length > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {missing.length} facteur(s) de conversion manquant(s) : les écarts des produits concernés ne sont pas calculés (« Conversion manquante »).
        </p>
      )}

      <Section title="Catalogue produits, coûts et taux de non-utilisateurs">
        <Table headers={["Code", "Produit", "Unité de référence", "Coût unitaire (FCFA / unité)", "Taux de non-utilisateurs (0 à 1)"]}>
          {params.products.map((p, i) => (
            <tr key={p.code} className="border-t border-border">
              <td className="px-3 py-1.5 font-mono text-xs">{p.code}</td>
              <td className="px-3 py-1.5">{p.label}</td>
              <td className="px-3 py-1.5">{p.referenceUnit === "ml" ? "millilitre (ml)" : "unité"}</td>
              <td className="px-3 py-1.5"><Input aria-label={`Coût unitaire de ${p.label}`} type="number" step="0.0001" min={0} className="h-8 w-32" value={p.unitCost} onChange={(e) => patch((d) => (d.products[i]!.unitCost = Number(e.target.value)))} /></td>
              <td className="px-3 py-1.5"><Input aria-label={`Taux de non-utilisateurs de ${p.label}`} type="number" step="0.01" min={0} max={1} className="h-8 w-24" value={p.nonUserRate} onChange={(e) => patch((d) => (d.products[i]!.nonUserRate = Number(e.target.value)))} /></td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Conversions : unité de livraison → unité de référence">
        <Table headers={["Produit", "Unité de livraison", "Facteur", ""]}>
          {params.conversions.map((c, i) => (
            <tr key={`${c.productCode}-${c.deliveryUnit}`} className="border-t border-border">
              <td className="px-3 py-1.5">{params.products.find((p) => p.code === c.productCode)?.label}</td>
              <td className="px-3 py-1.5">{c.deliveryUnit}</td>
              <td className="px-3 py-1.5">
                <Input
                  aria-label={`Facteur de ${c.deliveryUnit}`}
                  type="number"
                  step="0.0001"
                  min={0}
                  className="h-8 w-32"
                  value={c.factor ?? ""}
                  placeholder="À renseigner"
                  onChange={(e) => patch((d) => (d.conversions[i]!.factor = e.target.value === "" ? null : Number(e.target.value)))}
                />
              </td>
              <td className="px-3 py-1.5">{c.factor === null && <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white">Facteur manquant</span>}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Normes par client servi, avec date d'effet">
        <p className="mb-2 text-xs text-muted-foreground">Chaque mois utilise la dernière norme dont la date d&apos;effet précède son début ; celle d&apos;un hôtel l&apos;emporte sur celle du client. Modifier une norme ne change pas les mois déjà calculés avant un recalcul explicite.</p>
        <Table headers={["Produit", "Portée", "Effet au", "Norme par client (unité de référence)"]}>
          {params.norms.map((n, i) => (
            <tr key={`${n.productCode}-${n.hotelId}-${n.validFrom}`} className="border-t border-border">
              <td className="px-3 py-1.5">{params.products.find((p) => p.code === n.productCode)?.label}</td>
              <td className="px-3 py-1.5">{hotelName(n.hotelId)}</td>
              <td className="px-3 py-1.5">{formatDate(n.validFrom)}</td>
              <td className="px-3 py-1.5"><Input aria-label={`Norme ${n.productCode} ${hotelName(n.hotelId)} depuis le ${n.validFrom}`} type="number" step="0.0001" min={0} className="h-8 w-32" value={n.normPerClient} onChange={(e) => patch((d) => (d.norms[i]!.normPerClient = Number(e.target.value)))} /></td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Facteur long séjour par hôtel">
        <Table headers={["Hôtel", "Facteur (≥ 1)"]}>
          {pilotHotels.map((h) => (
            <tr key={h.id} className="border-t border-border">
              <td className="px-3 py-1.5">{h.name}</td>
              <td className="px-3 py-1.5"><Input aria-label={`Facteur long séjour de ${h.name}`} type="number" step="0.001" min={1} className="h-8 w-28" value={params.longStayFactor[h.id] ?? 1} onChange={(e) => patch((d) => (d.longStayFactor[h.id] = Number(e.target.value)))} /></td>
            </tr>
          ))}
        </Table>
      </Section>

      <Button type="submit" variant="accent" loading={busy}>
        <Save className="h-4 w-4" aria-hidden /> Enregistrer les paramètres
      </Button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="font-semibold text-primary">{title}</h3>
      {children}
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-border bg-background">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>{headers.map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
