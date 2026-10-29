"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Send, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createProspect } from "@/lib/services";
import { NEED_LABELS } from "@/lib/constants";
import { answerFor, QUICK_QUESTIONS, type ChatAnswer } from "@/lib/content/chat-kb";
import { useWhatsAppUrl } from "@/lib/hooks/use-whatsapp";
import type { Need } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

interface Msg extends Partial<ChatAnswer> {
  id: number;
  from: "bot" | "user";
  text: string;
  /** Message du bot en cours de frappe. */
  fresh?: boolean;
}

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

function LeadForm({ note, onDone }: { note?: string; onDone: () => void }) {
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
          ownerNote: note ? `Question posée au chatbot : ${note}` : undefined,
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

/** Texte qui s'écrit lettre par lettre, comme si quelqu'un tapait au clavier. */
function useTyped(text: string, active: boolean, onDone: () => void) {
  const [count, setCount] = useState(active ? 0 : text.length);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (!active) return;
    const speed = Math.max(8, Math.min(26, 1500 / text.length)); // réponse longue = frappe plus rapide
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let i = 0;
    const timer = setInterval(
      () => {
        i = reduced ? text.length : i + 1;
        setCount(i);
        if (i >= text.length) {
          clearInterval(timer);
          done.current();
        }
      },
      reduced ? 0 : speed,
    );
    return () => clearInterval(timer);
  }, [active, text]);

  return text.slice(0, count);
}

function BotBubble({ m, onTyped, onClose, onAsk, onLeadDone }: { m: Msg; onTyped: () => void; onClose: () => void; onAsk: (q: string) => void; onLeadDone: () => void }) {
  const shown = useTyped(m.text, !!m.fresh, onTyped);
  const complete = !m.fresh;
  return (
    <div className="inline-block max-w-full rounded-lg bg-muted px-3 py-2 text-left">
      <p>
        {shown}
        {!complete && <span className="caret ml-0.5 inline-block w-[2px] bg-primary">&nbsp;</span>}
      </p>
      {complete && m.links && (
        <ul className="mt-1 space-y-1">
          {m.links.map((l) => (
            <li key={l.href}>
              {l.href.startsWith("http") ? (
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="underline">{l.label}</a>
              ) : (
                <Link href={l.href} onClick={onClose} className="underline">{l.label}</Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {complete && m.form && <LeadForm note={m.note} onDone={onLeadDone} />}
      {complete && m.chips && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.chips.map((c) => (
            <button key={c} onClick={() => onAsk(c)} className="rounded-full border border-primary/30 bg-background px-2.5 py-1 text-xs hover:bg-accent">
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatWidget() {
  const waLink = useWhatsAppUrl("Bonjour, je vous contacte depuis le site.");
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: 0,
      from: "bot",
      text: "Bonjour, je suis l'assistant de MANGA PERFORMANCE. Posez-moi votre question ou choisissez un sujet ci-dessous.",
    },
  ]);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, typing]);

  const push = (...m: Omit<Msg, "id">[]) => setMessages((prev) => [...prev, ...m.map((x) => ({ ...x, id: nextId.current++ }))]);
  const markTyped = (id: number) => {
    setBusy(false);
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, fresh: false } : x)));
  };

  const ask = (text: string) => {
    if (typing || busy) return;
    push({ from: "user", text });
    setTyping(true);
    setBusy(true);
    setTimeout(() => {
      setTyping(false);
      push({ from: "bot", fresh: true, ...answerFor(text, { waLink }) });
    }, 650);
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Fermer l'assistant" : "Ouvrir l'assistant"}
        aria-expanded={open}
        className={cn(
          "fixed bottom-20 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border-2 border-accent bg-white text-primary shadow-lg",
          !open && "pulse-ring",
        )}
      >
        {open ? <X aria-hidden /> : <Bot aria-hidden />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Assistant MANGA PERFORMANCE"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          className="rise fixed bottom-36 right-4 z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        >
          <header className="bg-primary px-4 py-3 text-primary-foreground">
            <p className="font-semibold">Assistant MANGA PERFORMANCE</p>
            <p className="text-xs text-slate-300">Réponses automatiques — un consultant vous recontacte sous 24 h ouvrées</p>
          </header>
          <div ref={logRef} role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {messages.map((m) => (
              <div key={m.id} className={m.from === "user" ? "text-right" : undefined}>
                {m.from === "user" ? (
                  <div className="inline-block rounded-lg bg-accent px-3 py-2 text-left text-accent-foreground">{m.text}</div>
                ) : (
                  <BotBubble
                    m={m}
                    onTyped={() => markTyped(m.id)}
                    onClose={() => setOpen(false)}
                    onAsk={ask}
                    onLeadDone={() => {
                      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, form: false } : x)));
                      push({ from: "bot", fresh: true, text: "Merci ! Votre demande est enregistrée, un consultant vous recontacte sous 24 h ouvrées." });
                    }}
                  />
                )}
              </div>
            ))}
            {typing && (
              <p className="inline-block rounded-lg bg-muted px-3 py-2 text-muted-foreground" aria-label="L'assistant écrit">
                <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
              </p>
            )}
          </div>
          <div role="group" aria-label="Choix rapides" className="flex flex-wrap gap-1.5 border-t border-border p-2">
            {QUICK_QUESTIONS.map((q) => (
              <button key={q} onClick={() => ask(q)} disabled={typing || busy} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50">
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (!text) return;
              setDraft("");
              ask(text);
            }}
          >
            <label htmlFor="chat-input" className="sr-only">Votre message</label>
            <input
              id="chat-input"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Écrivez votre question…"
              autoComplete="off"
              className="h-9 min-w-0 flex-1 rounded-md border border-border px-3 text-sm"
            />
            <Button type="submit" size="sm" aria-label="Envoyer" disabled={!draft.trim() || typing || busy}>
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
