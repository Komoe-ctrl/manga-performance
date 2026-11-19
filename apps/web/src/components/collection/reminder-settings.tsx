"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { getReminderRules, saveReminderRules } from "@/lib/services/collection";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";

type Rules = Awaited<ReturnType<typeof getReminderRules>>;

/** Règles de relance (avenant §6) : par défaut J-2, J+1, J+3, escalade à J+5, plafond de 4 relances. */
export function ReminderSettings() {
  const data = useAsync(getReminderRules);
  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Paramètres indisponibles." onRetry={data.reload} />;
  return <RulesForm initial={data.data} />;
}

function RulesForm({ initial }: { initial: Rules }) {
  const [rules, setRules] = useState<Rules>(initial);
  const [busy, setBusy] = useState(false);
  const num = (v: string) => Math.max(0, Number.parseInt(v, 10) || 0);

  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await saveReminderRules(rules);
          toast.success("Règles de relance enregistrées");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Enregistrement impossible.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">Les relances partent chaque jour à l&apos;heure choisie. Toute relance est journalisée dans l&apos;historique de la période.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rappel avant l'échéance (jours)" htmlFor="rm-before">
          <Input id="rm-before" type="number" min={0} value={rules.beforeDue} onChange={(e) => setRules({ ...rules, beforeDue: num(e.target.value) })} />
        </Field>
        <Field label="Relances après l'échéance (jours, séparés par une virgule)" htmlFor="rm-after">
          <Input id="rm-after" value={rules.afterDue.join(", ")} onChange={(e) => setRules({ ...rules, afterDue: e.target.value.split(",").map((x) => num(x.trim())).filter((x) => x > 0) })} />
        </Field>
        <Field label="Escalade : direction en copie à J+" htmlFor="rm-esc">
          <Input id="rm-esc" type="number" min={1} value={rules.escalationDay} onChange={(e) => setRules({ ...rules, escalationDay: num(e.target.value) })} />
        </Field>
        <Field label="Plafond de relances par période" htmlFor="rm-cap">
          <Input id="rm-cap" type="number" min={1} max={10} value={rules.cap} onChange={(e) => setRules({ ...rules, cap: num(e.target.value) })} />
        </Field>
        <Field label="Heure d'envoi" htmlFor="rm-hour">
          <Input id="rm-hour" type="number" min={0} max={23} value={rules.sendHour} onChange={(e) => setRules({ ...rules, sendHour: Math.min(23, num(e.target.value)) })} />
        </Field>
      </div>
      <Button type="submit" variant="accent" loading={busy}>Enregistrer</Button>
    </form>
  );
}
