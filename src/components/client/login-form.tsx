"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSession } from "@/lib/auth/session";
import { authenticateClient } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const schema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});
type Values = z.infer<typeof schema>;

/** Connexion simulée : aucun mot de passe n'est réellement vérifié. */
export function ClientLoginForm() {
  const { signIn } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={handleSubmit(async (v) => {
        setError(null);
        const res = await authenticateClient(v.email, v.password);
        if (!res.ok) return setError(res.reason);
        signIn({ role: "client", clientId: res.clientId });
        router.push("/espace-client");
      })}
    >
      <Field label="Email" htmlFor="login-email" error={errors.email?.message}>
        <Input id="login-email" type="email" autoComplete="username" {...register("email")} />
      </Field>
      <Field label="Mot de passe" htmlFor="login-password" error={errors.password?.message}>
        <Input id="login-password" type="password" autoComplete="current-password" {...register("password")} />
      </Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full" disabled={isSubmitting}>Se connecter</Button>
      <p className="text-center text-sm">
        <Link href="/espace-client/mot-de-passe-oublie" className="underline">Mot de passe oublié ?</Link>
      </p>
    </form>
  );
}
