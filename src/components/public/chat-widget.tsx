"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Send, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createProspect } from "@/lib/services";
import { NEED_LABELS } from "@/lib/constants";
import { services } from "@/lib/content/site";
import { WHATSAPP_NUMBER } from "@/lib/nav";
import type { Need } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

type Menu = "services" | "tarifs" | "delais" | "recontact" | "whatsapp";
interface Msg {
  id: number;
  from: "bot" | "user";
  text: string;
  links?: { href: string; label: string }[];
  form?: boolean;
}

const OPTIONS: { key: Menu; label: string }[] = [
  { key: "services", label: "Nos services" },
  { key: "tarifs", label: "Tarifs" },
  { key: "delais", label: "Délais" },
  { key: "recontact", label: "Être recontacté" },
  { key: "whatsapp", label: "Parler sur WhatsApp" },
];

const waLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Bonjour, je vous contacte depuis le site.")}`;

const needKeys = Object.keys(NEED_LABELS) as [Need, ...Need[]];
const leadSchema = z
  .object({
    name: z.string().min(2, "Nom requis"),
    email: z.string().email("Email invalide").or(z.literal("")),
    phone: z.string(),
    need: z.enum(needKeys),
  })
  .refine((v) => v.email || v.phone, { path: ["email"], message: "Email ou téléphone requis" });
type LeadValues = z.infer<typeof leadSchema>;

function LeadForm({ onDone }: { onDone: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LeadValues>({ resolver: zodResolver(leadSchema), defaultValues: { email: "", phone: "", need: "autre" } });

  return (
    <form
      noValidate
      className="mt-2 space-y-2 rounded-md bg-background p-3"
      onSubmit={handleSubmit(async (v) => {
        await createProspect({
          companyName: v.name,
          contactName: v.name,
          email: v.email || undefined,
          phone: v.phone || undefined,
          sector: "Non précisé",
          city: "Abidjan",
          size: "pme",
          need: v.need,
          source: "chatbot",
        });
        onDone();
      })}
    >
      <Field label="Nom *" htmlFor="chat-name" error={errors.name?.message}>
        <Input id="chat-name" autoComplete="name" {...register("name")} />
      </Field>
      <Field label="Email" htmlFor="chat-email" error={errors.email?.message}>
        <Input id="chat-email" type="email" autoComplete="email" {...register("email")} />
      </Field>
      <Field label="Téléphone" htmlFor="chat-phone">
        <Input id="chat-phone" type="tel" autoComplete="tel" {...register("phone")} />
      </Field>
      <Field label="Besoin" htmlFor="chat-need">
        <Select id="chat-need" {...register("need")}>
          {needKeys.map((k) => <option key={k} value={k}>{NEED_LABELS[k]}</option>)}
        </Select>
      </Field>
      <Button type="submit" size="sm" disabled={isSubmitting}><Send className="h-4 w-4" aria-hidden /> Envoyer</Button>
    </form>
  );
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { id: 0, from: "bot", text: "Bonjour, je suis l'assistant de MANGA PERFORMANCE. Comment puis-je vous aider ?" },
  ]);
  const nextId = useRef(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const push = (...m: Omit<Msg, "id">[]) => setMessages((prev) => [...prev, ...m.map((x) => ({ ...x, id: nextId.current++ }))]);

  const choose = (key: Menu) => {
    const label = OPTIONS.find((o) => o.key === key)!.label;
    const user: Omit<Msg, "id"> = { from: "user", text: label };
    switch (key) {
      case "services":
        return push(user, {
          from: "bot",
          text: "Nous accompagnons les entreprises sur quatre missions :",
          links: services.map((s) => ({ href: `/services/${s.slug}`, label: s.title })),
        });
      case "tarifs":
        return push(user, {
          from: "bot",
          text: "Chaque mission est chiffrée sur mesure selon votre besoin. Je vous invite à être recontacté pour recevoir une proposition adaptée.",
        });
      case "delais":
        return push(user, {
          from: "bot",
          text: "Les délais dépendent de la mission et de la disponibilité de vos données. Un calendrier précis vous est proposé dès le premier échange.",
          links: [{ href: "/contact", label: "Prendre rendez-vous" }],
        });
      case "recontact":
        return push(user, { from: "bot", text: "Laissez-moi vos coordonnées, un consultant vous recontacte sous 24 h ouvrées.", form: true });
      case "whatsapp":
        return push(user, { from: "bot", text: "Vous pouvez nous écrire directement sur WhatsApp :", links: [{ href: waLink, label: "Ouvrir WhatsApp" }] });
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Fermer l'assistant" : "Ouvrir l'assistant"}
        aria-expanded={open}
        className="fixed bottom-20 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
      >
        {open ? <X aria-hidden /> : <Bot aria-hidden />}
      </button>

      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Assistant MANGA PERFORMANCE"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          className="fixed bottom-36 right-4 z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl focus:outline-none"
        >
          <header className="bg-primary px-4 py-3 text-primary-foreground">
            <p className="font-semibold">Assistant MANGA PERFORMANCE</p>
            <p className="text-xs text-slate-300">Réponses automatiques — un consultant vous recontacte sous 24 h ouvrées</p>
          </header>
          <div ref={logRef} role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {messages.map((m) => (
              <div key={m.id} className={m.from === "user" ? "text-right" : undefined}>
                <div className={m.from === "user" ? "inline-block rounded-lg bg-accent px-3 py-2 text-accent-foreground" : "inline-block rounded-lg bg-muted px-3 py-2 text-left"}>
                  <p>{m.text}</p>
                  {m.links && (
                    <ul className="mt-1 space-y-1">
                      {m.links.map((l) => (
                        <li key={l.href}>
                          {l.href.startsWith("http") ? (
                            <a href={l.href} target="_blank" rel="noopener noreferrer" className="underline">{l.label}</a>
                          ) : (
                            <Link href={l.href} onClick={() => setOpen(false)} className="underline">{l.label}</Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.form && (
                    <LeadForm
                      onDone={() => {
                        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, form: false } : x)));
                        push({ from: "bot", text: "Merci ! Votre demande est enregistrée, un consultant vous recontacte sous 24 h ouvrées." });
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div role="group" aria-label="Choix rapides" className="flex flex-wrap gap-1.5 border-t border-border p-2">
            {OPTIONS.map((o) => (
              <button key={o.key} onClick={() => choose(o.key)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
