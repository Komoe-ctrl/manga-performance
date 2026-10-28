"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { createProspect } from "@/lib/services";
import { NEED_LABELS, SECTORS } from "@/lib/constants";
import type { Need } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

const needKeys = Object.keys(NEED_LABELS) as [Need, ...Need[]];

const schema = z.object({
  name: z.string().min(2, "Nom requis"),
  email: z.string().email("Email invalide"),
  phone: z.string().optional(),
  sector: z.string().min(1, "Choisissez un secteur"),
  need: z.enum(needKeys),
  message: z.string().min(10, "Message trop court (10 caractères minimum)"),
  consent: z.boolean().refine((v) => v, "Le consentement est requis"),
});
type Values = z.infer<typeof schema>;

export function ContactForm() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { sector: "", need: "autre", consent: false },
  });

  const err = (id: keyof Values) => (errors[id] ? `${id}-error` : undefined);

  if (sent) {
    return (
      <div role="status" className="rounded-lg border border-border bg-muted p-6">
        <p className="font-semibold text-primary">Message envoyé</p>
        <p className="mt-1 text-sm">
          Merci, un consultant vous recontacte sous 24 h ouvrées. Votre demande est visible dans le CRM (mock).
        </p>
        <Button variant="outline" className="mt-4" onClick={() => setSent(false)}>
          Envoyer un autre message
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(async (v) => {
        await createProspect({
          companyName: v.name,
          contactName: v.name,
          email: v.email,
          phone: v.phone || undefined,
          sector: v.sector,
          city: "Abidjan",
          size: "pme",
          need: v.need,
          source: "site_formulaire",
          ownerNote: v.message,
        });
        toast.success("Message envoyé");
        reset();
        setSent(true);
      })}
    >
      <Field label="Nom *" htmlFor="name" error={errors.name?.message}>
        <Input id="name" autoComplete="name" aria-describedby={err("name")} {...register("name")} />
      </Field>
      <Field label="Email *" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-describedby={err("email")} {...register("email")} />
      </Field>
      <Field label="Téléphone" htmlFor="phone">
        <Input id="phone" type="tel" placeholder="+225 07 XX XX XX XX" autoComplete="tel" {...register("phone")} />
      </Field>
      <Field label="Secteur *" htmlFor="sector" error={errors.sector?.message}>
        <Select id="sector" aria-describedby={err("sector")} {...register("sector")}>
          <option value="">Sélectionnez…</option>
          {SECTORS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </Field>
      <Field label="Besoin" htmlFor="need">
        <Select id="need" {...register("need")}>
          {needKeys.map((k) => (
            <option key={k} value={k}>
              {NEED_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Message *" htmlFor="message" error={errors.message?.message}>
        <Textarea id="message" aria-describedby={err("message")} {...register("message")} />
      </Field>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" aria-describedby={err("consent")} {...register("consent")} />
          <span>
            J&apos;accepte le traitement de mes données selon la{" "}
            <Link href="/confidentialite" className="underline">
              politique de confidentialité
            </Link>
            .
          </span>
        </label>
        {errors.consent && (
          <p id="consent-error" role="alert" className="mt-1 text-xs text-danger">
            {errors.consent.message}
          </p>
        )}
      </div>
      <Button type="submit" disabled={isSubmitting}>
        Envoyer
      </Button>
    </form>
  );
}
