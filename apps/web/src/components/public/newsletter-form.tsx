"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { subscribeNewsletter } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const schema = z.object({ email: z.string().email("Email invalide") });
type Values = z.infer<typeof schema>;

export function NewsletterForm() {
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  if (done) {
    return (
      <p role="status" className="text-sm">
        Merci ! Un email de confirmation vous a été envoyé (double opt-in simulé).
      </p>
    );
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(async ({ email }) => {
        await subscribeNewsletter(email);
        toast.success("Inscription enregistrée");
        setDone(true);
      })}
      className="flex flex-wrap items-end gap-3"
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
      <Button type="submit" variant="accent" disabled={isSubmitting}>
        S&apos;inscrire
      </Button>
    </form>
  );
}
