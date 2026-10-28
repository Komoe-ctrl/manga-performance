"use client";

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { createProspect } from "@/lib/services";
import { CITIES, NEED_LABELS, SECTORS, SIZE_LABELS, SOURCE_LABELS } from "@/lib/constants";
import type { CompanySize, Need, ProspectSource } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

const needs = Object.keys(NEED_LABELS) as [Need, ...Need[]];
const sizes = Object.keys(SIZE_LABELS) as [CompanySize, ...CompanySize[]];
const sources = Object.keys(SOURCE_LABELS) as [ProspectSource, ...ProspectSource[]];

const schema = z.object({
  companyName: z.string().min(2, "Entreprise requise"),
  contactName: z.string().min(2, "Contact requis"),
  email: z.string().email("Email invalide").or(z.literal("")),
  phone: z.string(),
  sector: z.string().min(1, "Secteur requis"),
  city: z.string().min(1, "Ville requise"),
  size: z.enum(sizes),
  need: z.enum(needs),
  source: z.enum(sources),
  estimatedValue: z.string().regex(/^\d*$/, "Chiffres uniquement"),
  ownerNote: z.string(),
});
type Values = z.infer<typeof schema>;

const defaults: Values = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  sector: "",
  city: "",
  size: "pme",
  need: "autre",
  source: "manuel",
  estimatedValue: "",
  ownerNote: "",
};

/** Panneau latéral « Nouveau prospect » (dialog natif : focus et Échap gérés). */
export function ProspectPanel({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

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
      aria-labelledby="panel-title"
      className="ml-auto mr-0 h-full max-h-full w-full max-w-md overflow-y-auto p-6 backdrop:bg-black/50"
    >
      <h2 id="panel-title" className="text-lg font-bold text-primary">
        Nouveau prospect
      </h2>
      <form
        noValidate
        className="mt-4 space-y-3"
        onSubmit={handleSubmit(async (v) => {
          await createProspect({
            companyName: v.companyName,
            contactName: v.contactName,
            email: v.email || undefined,
            phone: v.phone || undefined,
            sector: v.sector,
            city: v.city,
            size: v.size,
            need: v.need,
            source: v.source,
            estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : undefined,
            ownerNote: v.ownerNote || undefined,
          });
          toast.success("Prospect créé");
          reset(defaults);
          onCreated();
          onClose();
        })}
      >
        <Field label="Entreprise *" htmlFor="np-company" error={errors.companyName?.message}>
          <Input id="np-company" {...register("companyName")} />
        </Field>
        <Field label="Contact *" htmlFor="np-contact" error={errors.contactName?.message}>
          <Input id="np-contact" {...register("contactName")} />
        </Field>
        <Field label="Email" htmlFor="np-email" error={errors.email?.message}>
          <Input id="np-email" type="email" {...register("email")} />
        </Field>
        <Field label="Téléphone" htmlFor="np-phone">
          <Input id="np-phone" type="tel" placeholder="+225 07 XX XX XX XX" {...register("phone")} />
        </Field>
        <Field label="Secteur *" htmlFor="np-sector" error={errors.sector?.message}>
          <Select id="np-sector" {...register("sector")}>
            <option value="">Sélectionnez…</option>
            {SECTORS.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Ville *" htmlFor="np-city" error={errors.city?.message}>
          <Select id="np-city" {...register("city")}>
            <option value="">Sélectionnez…</option>
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Taille" htmlFor="np-size">
          <Select id="np-size" {...register("size")}>
            {sizes.map((s) => <option key={s} value={s}>{SIZE_LABELS[s]}</option>)}
          </Select>
        </Field>
        <Field label="Besoin" htmlFor="np-need">
          <Select id="np-need" {...register("need")}>
            {needs.map((n) => <option key={n} value={n}>{NEED_LABELS[n]}</option>)}
          </Select>
        </Field>
        <Field label="Source" htmlFor="np-source">
          <Select id="np-source" {...register("source")}>
            {sources.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
          </Select>
        </Field>
        <Field label="Valeur estimée (FCFA)" htmlFor="np-value" error={errors.estimatedValue?.message}>
          <Input id="np-value" inputMode="numeric" {...register("estimatedValue")} />
        </Field>
        <Field label="Note" htmlFor="np-note">
          <Textarea id="np-note" {...register("ownerNote")} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={isSubmitting}>Créer</Button>
        </div>
      </form>
    </dialog>
  );
}
