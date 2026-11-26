"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import type { PilotHotel } from "@/lib/services/pilot";
import { addPilotNorm, getPilotParamsDb, savePilotBounds, savePilotConversion, savePilotProduct, setPilotLongStayFactor } from "@/lib/services/pilot";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

type Params = Awaited<ReturnType<typeof getPilotParamsDb>>;

/** Paramètres CPRA réels (avenant §10) : catalogue, conversions, normes datées, long séjour et bornes. */
export function CpraSettingsDb({ clientId, hotels, onSaved }: { clientId: string; hotels: PilotHotel[]; onSaved: () => void }) {
  const loaded = useAsync(() => getPilotParamsDb(clientId), [clientId]);
  if (loaded.status === "loading") return <LoadingState />;
  if (loaded.status === "error") return <ErrorState message="Paramètres indisponibles." onRetry={loaded.reload} />;
  return <Form key={`${clientId}-${loaded.data.products.length}`} clientId={clientId} initial={loaded.data} hotels={hotels} onSaved={() => { loaded.reload(); onSaved(); }} />;
}

function Form({ clientId, initial, hotels, onSaved }: { clientId: string; initial: Params; hotels: PilotHotel[]; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState({ code: "", label: "", referenceUnit: "unite" as "unite" | "ml" });
  const [norm, setNorm] = useState({ productId: initial.products[0]?.id ?? "", entityId: "", validFrom: "2026-01-01", normPerClient: "1", nonUserRate: "0", unitCostFcfa: "0" });
  const [longStay, setLongStay] = useState({ entityId: hotels[0]?.id ?? "", validFrom: "2026-01-01", factor: "1" });
  const [bounds, setBounds] = useState(initial.bounds);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const num = (value: string) => Number.parseFloat(value.replace(",", "."));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Toute modification crée un nouvel historique ; elle ne change pas les résultats déjà calculés. Lancez un recalcul pour l&apos;appliquer.</p>

      <section aria-label="Catalogue produits" className="space-y-3 rounded-xl border border-border bg-background p-4">
        <h3 className="font-semibold text-primary">Catalogue produits</h3>
        {initial.products.length === 0 ? <EmptyState message="Aucun produit : ajoutez le premier consommable suivi." /> : (
          <ul className="divide-y divide-border text-sm">
            {initial.products.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><strong>{p.code}</strong> — {p.label} ({p.referenceUnit === "ml" ? "ml" : "unité"}) {!p.active && <span className="text-muted-foreground">(inactif)</span>}</span>
                <span className="text-xs text-muted-foreground">{p.conversions.length} unité(s) · {p.norms.length} norme(s)</span>
              </li>
            ))}
          </ul>
        )}
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => savePilotProduct({ clientId, ...product }), "Produit enregistré."); }}>
          <Field label="Code" htmlFor="cpra-product-code"><Input id="cpra-product-code" value={product.code} onChange={(e) => setProduct({ ...product, code: e.target.value.toUpperCase() })} required className="w-28" /></Field>
          <Field label="Libellé" htmlFor="cpra-product-label"><Input id="cpra-product-label" value={product.label} onChange={(e) => setProduct({ ...product, label: e.target.value })} required className="w-56" /></Field>
          <Field label="Unité de référence" htmlFor="cpra-product-unit">
            <Select id="cpra-product-unit" value={product.referenceUnit} onChange={(e) => setProduct({ ...product, referenceUnit: e.target.value as "unite" | "ml" })}><option value="unite">Unité</option><option value="ml">ml</option></Select>
          </Field>
          <Button type="submit" loading={busy} variant="accent">Ajouter le produit</Button>
        </form>
      </section>

      <section aria-label="Conversions" className="space-y-3 rounded-xl border border-border bg-background p-4">
        <h3 className="font-semibold text-primary">Unités de livraison et facteurs</h3>
        {initial.products.map((p) => (
          <div key={p.id} className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-semibold">{p.label}</p>
            {p.conversions.length === 0 && <p className="text-xs text-muted-foreground">Aucune unité déclarée.</p>}
            {p.conversions.map((c) => (
              <ConversionRow key={c.deliveryUnit} productId={p.id} unit={c.deliveryUnit} factor={c.factor} busy={busy} onSave={run} />
            ))}
          </div>
        ))}
      </section>

      <section aria-label="Normes" className="space-y-3 rounded-xl border border-border bg-background p-4">
        <h3 className="font-semibold text-primary">Normes datées</h3>
        <ul className="divide-y divide-border text-xs">
          {initial.products.flatMap((p) => p.norms.map((n) => (
            <li key={`${p.id}-${n.entityId ?? "client"}-${n.validFrom}`} className="py-1">
              {p.code} · {n.entityId ? hotels.find((h) => h.id === n.entityId)?.name ?? n.entityId : "Défaut client"} · depuis {n.validFrom.slice(0, 10)} · {n.normPerClient} / client · {n.nonUserRate * 100} % non-utilisateurs · {n.unitCost} FCFA
            </li>
          )))}
        </ul>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => addPilotNorm({ ...norm, productId: norm.productId || initial.products[0]!.id, entityId: norm.entityId || null, normPerClient: num(norm.normPerClient), nonUserRate: num(norm.nonUserRate), unitCostFcfa: num(norm.unitCostFcfa) }), "Norme ajoutée."); }}>
          <Field label="Produit" htmlFor="cpra-norm-product"><Select id="cpra-norm-product" value={norm.productId} onChange={(e) => setNorm({ ...norm, productId: e.target.value })}>{initial.products.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select></Field>
          <Field label="Périmètre" htmlFor="cpra-norm-scope"><Select id="cpra-norm-scope" value={norm.entityId} onChange={(e) => setNorm({ ...norm, entityId: e.target.value })}><option value="">Défaut du client</option>{hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Select></Field>
          <Field label="Date d'effet" htmlFor="cpra-norm-date"><Input id="cpra-norm-date" type="date" value={norm.validFrom} onChange={(e) => setNorm({ ...norm, validFrom: e.target.value })} /></Field>
          <Field label="Norme / client" htmlFor="cpra-norm-value"><Input id="cpra-norm-value" value={norm.normPerClient} onChange={(e) => setNorm({ ...norm, normPerClient: e.target.value })} className="w-24" /></Field>
          <Field label="Non-utilisateurs" htmlFor="cpra-norm-rate"><Input id="cpra-norm-rate" value={norm.nonUserRate} onChange={(e) => setNorm({ ...norm, nonUserRate: e.target.value })} className="w-24" /></Field>
          <Field label="Coût unitaire" htmlFor="cpra-norm-cost"><Input id="cpra-norm-cost" value={norm.unitCostFcfa} onChange={(e) => setNorm({ ...norm, unitCostFcfa: e.target.value })} className="w-24" /></Field>
          <Button type="submit" loading={busy} variant="accent" disabled={initial.products.length === 0}>Ajouter la norme</Button>
        </form>
      </section>

      <section aria-label="Facteur long séjour" className="space-y-3 rounded-xl border border-border bg-background p-4">
        <h3 className="font-semibold text-primary">Facteur long séjour</h3>
        <ul className="divide-y divide-border text-xs">
          {initial.longStay.map((s) => <li key={`${s.entityId}-${s.validFrom}`} className="py-1">{s.entityName} · depuis {s.validFrom.slice(0, 10)} · ×{s.factor}</li>)}
        </ul>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => setPilotLongStayFactor({ ...longStay, factor: num(longStay.factor) }), "Facteur long séjour enregistré."); }}>
          <Field label="Hôtel" htmlFor="cpra-longstay-hotel"><Select id="cpra-longstay-hotel" value={longStay.entityId} onChange={(e) => setLongStay({ ...longStay, entityId: e.target.value })}>{hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Select></Field>
          <Field label="Date d'effet" htmlFor="cpra-longstay-date"><Input id="cpra-longstay-date" type="date" value={longStay.validFrom} onChange={(e) => setLongStay({ ...longStay, validFrom: e.target.value })} /></Field>
          <Field label="Facteur" htmlFor="cpra-longstay-factor"><Input id="cpra-longstay-factor" value={longStay.factor} onChange={(e) => setLongStay({ ...longStay, factor: e.target.value })} className="w-24" /></Field>
          <Button type="submit" loading={busy} variant="accent" disabled={hotels.length === 0}>Enregistrer</Button>
        </form>
      </section>

      <section aria-label="Bornes de couverture" className="space-y-3 rounded-xl border border-border bg-background p-4">
        <h3 className="font-semibold text-primary">Bornes de couverture (%)</h3>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => savePilotBounds({ clientId, ...bounds }), "Bornes enregistrées."); }}>
          {([["strongUnder", "Sous forte"], ["under", "Sous"], ["overFrom", "Sur"], ["strongOver", "Sur forte"]] as const).map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`cpra-bound-${key}`}><Input id={`cpra-bound-${key}`} value={bounds[key]} onChange={(e) => setBounds({ ...bounds, [key]: num(e.target.value) })} className="w-28" /></Field>
          ))}
          <Button type="submit" loading={busy} variant="accent">Enregistrer les bornes</Button>
        </form>
      </section>
    </div>
  );
}

function ConversionRow({ productId, unit, factor, busy, onSave }: { productId: string; unit: string; factor: number | null; busy: boolean; onSave: (action: () => Promise<unknown>, message: string) => Promise<void> }) {
  const [value, setValue] = useState(factor === null ? "" : String(factor));
  return (
    <form className="flex flex-wrap items-end gap-2 py-1" onSubmit={(e) => { e.preventDefault(); void onSave(() => savePilotConversion(productId, unit, value.trim() === "" ? null : Number.parseFloat(value.replace(",", "."))), "Conversion enregistrée."); }}>
      <span className="w-44 text-sm">{unit}</span>
      <Field label={`Facteur pour ${unit}`} htmlFor={`conversion-${productId}-${unit}`}><Input id={`conversion-${productId}-${unit}`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="À renseigner" className="w-32" /></Field>
      <Button type="submit" loading={busy} variant="outline">Enregistrer</Button>
    </form>
  );
}
