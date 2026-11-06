"use client";

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { submitLead } from "@/lib/services";
import { LeadGuardFields, useLeadGuard } from "@/components/public/lead-guard";
import { SECTORS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

const schema = z.object({
  name: z.string().min(2, "Nom requis"),
  email: z.string().email("Email invalide"),
  company: z.string().min(2, "Entreprise requise"),
  sector: z.string().min(1, "Choisissez un secteur"),
});
type Values = z.infer<typeof schema>;

export function LeadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const guard = useLeadGuard();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { sector: "" } });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="lead-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg p-6 backdrop:bg-black/50"
    >
      <h2 id="lead-title" className="text-lg font-bold text-primary">
        Je veux ce tableau de bord
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Laissez vos coordonnées, je vous recontacte sous 24 h ouvrées.</p>
      <form
        noValidate
        className="relative mt-4 space-y-3"
        onSubmit={handleSubmit(async (v) => {
          try {
            await submitLead({
              source: "demo",
              name: v.name,
              email: v.email,
              company: v.company,
              sector: v.sector,
              need: "tableau_de_bord",
              message: "Demande issue du dashboard de démonstration",
              consent: true, // notice shown below the form
              ...guard.read(),
            });
          } catch (error) {
            guard.reset();
            toast.error(error instanceof Error ? error.message : "Envoi impossible, réessayez.");
            return;
          }
          guard.reset();
          toast.success("Demande envoyée");
          reset();
          onClose();
        })}
      >
        <Field label="Nom *" htmlFor="lead-name" error={errors.name?.message}>
          <Input id="lead-name" autoComplete="name" {...register("name")} />
        </Field>
        <Field label="Email *" htmlFor="lead-email" error={errors.email?.message}>
          <Input id="lead-email" type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Entreprise *" htmlFor="lead-company" error={errors.company?.message}>
          <Input id="lead-company" autoComplete="organization" {...register("company")} />
        </Field>
        <Field label="Secteur *" htmlFor="lead-sector" error={errors.sector?.message}>
          <Select id="lead-sector" {...register("sector")}>
            <option value="">Sélectionnez…</option>
            {SECTORS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <LeadGuardFields guard={guard} />
        <p className="text-xs text-muted-foreground">
          En envoyant ce formulaire, vous acceptez le traitement de vos données selon la{" "}
          <a href="/confidentialite" className="underline">politique de confidentialité</a>.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            Envoyer
          </Button>
        </div>
      </form>
    </dialog>
  );
}
