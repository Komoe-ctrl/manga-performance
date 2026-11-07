"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { USE_DB, subscribeNewsletter } from "@/lib/services";
import { LeadGuardFields, useLeadGuard } from "./lead-guard";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const schema = z.object({ email: z.string().email("Email invalide") });
type Values = z.infer<typeof schema>;

export function NewsletterForm() {
  const [done, setDone] = useState(false);
  const guard = useLeadGuard();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  if (done) {
    return (
      <p role="status" className="text-sm">
        {USE_DB
          ? "Merci ! Un email de confirmation vous a été envoyé : cliquez sur le lien pour finaliser votre inscription."
          : "Merci ! Un email de confirmation vous a été envoyé (double opt-in simulé)."}
      </p>
    );
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(async ({ email }) => {
        try {
          await subscribeNewsletter(email, guard.read());
        } catch (error) {
          guard.reset();
          toast.error(error instanceof Error ? error.message : "Inscription impossible, réessayez.");
          return;
        }
        guard.reset();
        toast.success("Inscription enregistrée");
        setDone(true);
      })}
      className="relative flex flex-wrap items-end gap-3"
    >
      <div className="min-w-60 flex-1">
        <Field label="Votre email" htmlFor="newsletter-email" error={errors.email?.message}>
          <Input
            id="newsletter-email"
            type="email"
            autoComplete="email"
            aria-describedby={errors.email ? "newsletter-email-error" : undefined}
            {...register("email")}
          />
        </Field>
      </div>
      <LeadGuardFields guard={guard} />
      <Button type="submit" variant="accent" disabled={isSubmitting}>
        S&apos;inscrire
      </Button>
      <p className="basis-full text-xs opacity-80">
        En vous inscrivant, vous acceptez de recevoir notre newsletter. Désinscription en un clic à tout moment.
      </p>
    </form>
  );
}
