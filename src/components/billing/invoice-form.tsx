"use client";

import { useRouter } from "next/navigation";
import { Info, Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { addDays } from "date-fns";
import { toast } from "sonner";
import { REFERENCE_DATE } from "@/lib/constants";
import { useAsync } from "@/lib/hooks/use-async";
import { createInvoice, invoiceTotals, listClients, nextInvoiceNumber } from "@/lib/services";
import { formatFCFA } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";

const num = (msg: string) => z.number({ error: msg }).min(0, "Valeur positive requise");

const schema = z.object({
  clientId: z.string().min(1, "Choisissez un client"),
  issuedAt: z.string().min(1, "Date requise"),
  dueAt: z.string().min(1, "Échéance requise"),
  vatPercent: num("TVA requise").max(100),
  lines: z
    .array(
      z.object({
        label: z.string().min(2, "Libellé requis"),
        quantity: num("Quantité requise").min(1, "Minimum 1"),
        unitPrice: num("Prix requis"),
      }),
    )
    .min(1, "Ajoutez au moins une ligne"),
});
type Values = z.infer<typeof schema>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const ISSUE_DEFAULT = REFERENCE_DATE.slice(0, 10);
const DUE_DEFAULT = iso(addDays(new Date(REFERENCE_DATE), 30));

export function InvoiceForm() {
  const router = useRouter();
  const meta = useAsync(async () => ({ clients: await listClients(), number: await nextInvoiceNumber() }));
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      clientId: "",
      issuedAt: ISSUE_DEFAULT,
      dueAt: DUE_DEFAULT,
      vatPercent: 18,
      lines: [{ label: "", quantity: 1, unitPrice: 0 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watched = useWatch({ control });

  if (meta.status === "loading") return <LoadingState />;
  if (meta.status === "error") return <ErrorState message="Formulaire indisponible." onRetry={meta.reload} />;

  const totals = invoiceTotals({
    lines: (watched.lines ?? []).map((l) => ({
      label: l?.label ?? "",
      quantity: Number(l?.quantity) || 0,
      unitPrice: Number(l?.unitPrice) || 0,
    })),
    vatRate: (Number(watched.vatPercent) || 0) / 100,
  });

  const submit = (status: "brouillon" | "emise") =>
    handleSubmit(async (v) => {
      const inv = await createInvoice({
        clientId: v.clientId,
        lines: v.lines,
        vatRate: v.vatPercent / 100,
        issuedAt: new Date(v.issuedAt).toISOString(),
        dueAt: new Date(v.dueAt).toISOString(),
        status,
      });
      toast.success(`Facture ${inv.number} ${status === "emise" ? "émise" : "enregistrée en brouillon"}`);
      router.push(`/admin/factures/${inv.id}`);
    });

  return (
    <form noValidate className="max-w-4xl space-y-6" onSubmit={submit("emise")}>
      <div role="note" className="flex gap-2 rounded-lg border border-border bg-muted p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        La facture fiscale doit être émise via la plateforme FNE de la DGI. Renseignez le numéro FNE une fois émise.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm sm:col-span-2">
          Numéro : <strong>{meta.data.number}</strong> (automatique)
        </p>
        <Field label="Client *" htmlFor="clientId" error={errors.clientId?.message}>
          <Select id="clientId" {...register("clientId")}>
            <option value="">Sélectionnez…</option>
            {meta.data.clients.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </Select>
        </Field>
        <Field label="TVA (%)" htmlFor="vat" error={errors.vatPercent?.message}>
          <Input id="vat" type="number" step="0.5" {...register("vatPercent", { valueAsNumber: true })} />
        </Field>
        <Field label="Date d'émission" htmlFor="issuedAt" error={errors.issuedAt?.message}>
          <Input id="issuedAt" type="date" {...register("issuedAt")} />
        </Field>
        <Field label="Échéance" htmlFor="dueAt" error={errors.dueAt?.message}>
          <Input id="dueAt" type="date" {...register("dueAt")} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold text-primary">Prestations</legend>
        {fields.map((f, i) => (
          <div key={f.id} className="grid items-start gap-2 sm:grid-cols-[1fr_90px_160px_auto]">
            <Field label={`Libellé ${i + 1}`} htmlFor={`l-${i}`} error={errors.lines?.[i]?.label?.message}>
              <Input id={`l-${i}`} {...register(`lines.${i}.label`)} />
            </Field>
            <Field label="Qté" htmlFor={`q-${i}`} error={errors.lines?.[i]?.quantity?.message}>
              <Input id={`q-${i}`} type="number" min={1} {...register(`lines.${i}.quantity`, { valueAsNumber: true })} />
            </Field>
            <Field label="Prix unitaire (FCFA)" htmlFor={`p-${i}`} error={errors.lines?.[i]?.unitPrice?.message}>
              <Controller
                control={control}
                name={`lines.${i}.unitPrice`}
                render={({ field }) => (
                  <Input
                    id={`p-${i}`}
                    type="number"
                    min={0}
                    value={Number.isNaN(field.value) ? "" : field.value}
                    onChange={(e) => field.onChange(e.target.value === "" ? NaN : Number(e.target.value))}
                  />
                )}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              className="mt-6"
              aria-label={`Supprimer la ligne ${i + 1}`}
              onClick={() => remove(i)}
              disabled={fields.length === 1}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        {errors.lines?.message && <p role="alert" className="text-xs text-danger">{errors.lines.message}</p>}
        <Button type="button" variant="outline" size="sm" onClick={() => append({ label: "", quantity: 1, unitPrice: 0 })}>
          <Plus className="h-4 w-4" aria-hidden /> Ajouter une ligne
        </Button>
      </fieldset>

      <dl className="ml-auto w-full max-w-xs space-y-1 rounded-lg border border-border p-4 text-sm" aria-live="polite">
        <div className="flex justify-between"><dt>Total HT</dt><dd>{formatFCFA(totals.ht)}</dd></div>
        <div className="flex justify-between"><dt>TVA</dt><dd>{formatFCFA(totals.vat)}</dd></div>
        <div className="flex justify-between border-t border-border pt-1 font-bold text-primary"><dt>Total TTC</dt><dd>{formatFCFA(totals.ttc)}</dd></div>
      </dl>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={submit("brouillon")}>
          Enregistrer en brouillon
        </Button>
        <Button type="submit" variant="accent" disabled={isSubmitting}>Émettre la facture</Button>
      </div>
    </form>
  );
}
