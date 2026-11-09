"use client";

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { createProspect } from "@/lib/services";
import { CITIES, NEED_LABELS, SECTORS, SIZE_LABELS, SOURCE_LABELS } from "@/lib/constants";
import type { CompanySize, Need, ProspectSource } from "@/lib/types";
import { X } from "lucide-react";
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
      className="ml-auto mr-0 h-full max-h-full w-full max-w-md overflow-y-auto p-0 backdrop:bg-black/50"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <h2 id="panel-title" className="text-lg font-bold text-primary">
          Nouveau prospect
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Fermer" onClick={onClose}>
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      <form
        noValidate
        className="space-y-3 px-6 pb-0 pt-4"
        onSubmit={handleSubmit(async (v) => {
          try {
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
          } catch (error) {
            // A duplicate, or a server refusal: the form stays open with what was typed.
            toast.error(error instanceof Error ? error.message : "Création impossible, réessayez.");
          }
        })}
      >
        <Field label="Entreprise *" htmlFor="np-company" error={errors.companyName?.message}>
          <Input id="np-company" {...register("companyName")} />
        </Field>
        <Field label="Contact *" htmlFor="np-contact" error={errors.contactName?.message}>
          <Input id="np-contact" {...register("contactName")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" htmlFor="np-email" error={errors.email?.message}>
            <Input id="np-email" type="email" {...register("email")} />
          </Field>
          <Field label="Téléphone" htmlFor="np-phone">
            <Input id="np-phone" type="tel" placeholder="+225 07 XX XX XX XX" {...register("phone")} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
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
        <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t border-border bg-background px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={isSubmitting}>Créer le prospect</Button>
        </div>
      </form>
    </dialog>
  );
}
