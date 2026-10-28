"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { getSettings, saveSettings, type Settings } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";

function Form({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="max-w-3xl space-y-8"
      onSubmit={async (e) => {
        e.preventDefault();
        if (s.vatPercent < 0 || s.vatPercent > 100) return toast.error("TVA invalide");
        setSaving(true);
        await saveSettings(s);
        setSaving(false);
        toast.success("Paramètres enregistrés");
      }}
    >
      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 font-semibold text-primary">Profil du cabinet</legend>
        <Field label="Nom" htmlFor="st-name"><Input id="st-name" value={s.cabinetName} onChange={(e) => set("cabinetName", e.target.value)} /></Field>
        <Field label="Adresse" htmlFor="st-address"><Input id="st-address" value={s.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Téléphone" htmlFor="st-phone"><Input id="st-phone" type="tel" value={s.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email" htmlFor="st-email"><Input id="st-email" type="email" value={s.email} onChange={(e) => set("email", e.target.value)} /></Field>
        </div>
        <div>
          <label htmlFor="st-logo" className="text-sm font-medium">Logo</label>
          {/* Téléversement simulé : seul le nom du fichier est conservé */}
          <input id="st-logo" type="file" accept="image/*" className="mt-1 block text-sm" onChange={(e) => set("logoName", e.target.files?.[0]?.name ?? "")} />
          {s.logoName && <p className="mt-1 text-xs text-muted-foreground">{s.logoName}</p>}
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border border-border p-4">
        <legend className="px-1 font-semibold text-primary">Règles de relance</legend>
        <p className="text-xs text-muted-foreground">Rappels internes planifiés après le premier contact.</p>
        {([["j7", "J+7"], ["j15", "J+15"], ["j30", "J+30"]] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.followUps[k]} onChange={(e) => set("followUps", { ...s.followUps, [k]: e.target.checked })} />
            Relance {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 font-semibold text-primary">Facturation</legend>
        <Field label="TVA par défaut (%)" htmlFor="st-vat">
          <Input id="st-vat" type="number" step="0.5" className="max-w-32" value={s.vatPercent} onChange={(e) => set("vatPercent", Number(e.target.value))} />
        </Field>
        <Field label="Mentions sur les factures" htmlFor="st-mentions"><Textarea id="st-mentions" value={s.invoiceMentions} onChange={(e) => set("invoiceMentions", e.target.value)} /></Field>
        <Field label="Coordonnées bancaires" htmlFor="st-bank"><Textarea id="st-bank" className="min-h-20" value={s.bankDetails} onChange={(e) => set("bankDetails", e.target.value)} /></Field>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 font-semibold text-primary">WhatsApp</legend>
        <Field label="Numéro WhatsApp (format international, sans +)" htmlFor="st-wanum"><Input id="st-wanum" inputMode="numeric" value={s.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value.replace(/D/g, ""))} /></Field>
        <Field label="Message prérempli" htmlFor="st-wa"><Textarea id="st-wa" className="min-h-20" value={s.whatsappMessage} onChange={(e) => set("whatsappMessage", e.target.value)} /></Field>
      </fieldset>

      <Button type="submit" variant="accent" disabled={saving}>Enregistrer</Button>
    </form>
  );
}

export function SettingsForm() {
  const settings = useAsync(getSettings);
  if (settings.status === "loading") return <LoadingState />;
  if (settings.status === "error") return <ErrorState message="Paramètres indisponibles." onRetry={settings.reload} />;
  return <Form initial={settings.data} />;
}
