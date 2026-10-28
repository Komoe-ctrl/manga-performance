"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Send, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createProspect } from "@/lib/services";
import { NEED_LABELS } from "@/lib/constants";
import { contactInfo, services } from "@/lib/content/site";
import { useWhatsAppUrl } from "@/lib/hooks/use-whatsapp";
import type { Need } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

type Intent =
  | "services" | "tarifs" | "delais" | "recontact" | "whatsapp"
  | "coordonnees" | "horaires" | "demo" | "blog" | "bonjour" | "merci" | "aurevoir" | "inconnu"
  | `service:${string}`;

interface Msg {
  id: number;
  from: "bot" | "user";
  text: string;
  links?: { href: string; label: string }[];
  form?: boolean;
}

const OPTIONS: { key: Intent; label: string }[] = [
  { key: "services", label: "Nos services" },
  { key: "tarifs", label: "Tarifs" },
  { key: "delais", label: "Délais" },
  { key: "recontact", label: "Être recontacté" },
  { key: "whatsapp", label: "Parler sur WhatsApp" },
];

/** Reconnaissance d'intention par mots-clés : chatbot scripté, sans IA. L'ordre compte (le plus précis d'abord). */
const RULES: [Intent, RegExp][] = [
  ["service:maitrise-des-couts", /maitris|reduire|baisser|ecart/],
  ["tarifs", /prix|tarif|cout|combien|devis|honoraire|payer|cher|budget/],
  ["delais", /delai|duree|temps|quand|rapide|livraison|urgent/],
  ["service:business-plan-bancable", /business ?plan|financement|banque|bancable|investisseur/],
  ["service:tableaux-de-bord-kpi", /tableau|kpi|indicateur|dashboard|pilotage/],
  ["service:tresorerie", /tresor|cash|encaissement/],
  ["whatsapp", /whatsapp|watsap/],
  ["recontact", /rappel|recontact|contacter|joindre|rendez|rdv|appel|consultant|conseiller|humain|parler/],
  ["coordonnees", /mail|adresse|telephone|numero|coordonnee|localis|ou etes|etes ou|trouve|situe|abidjan/],
  ["horaires", /horaire|ouvert|ferme|heure/],
  ["demo", /demo|exemple|essai|tester/],
  ["blog", /blog|article|actualite|conseil/],
  ["services", /service|prestation|mission|offre|proposez|faites|aide/],
  ["bonjour", /bonjour|bonsoir|salut|hello|coucou|bjr/],
  ["merci", /merci|super|parfait|genial/],
  ["aurevoir", /au revoir|bye|a bientot|bonne journee/],
];

const normalize = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export function detectIntent(text: string): Intent {
  const t = normalize(text);
  return RULES.find(([, re]) => re.test(t))?.[0] ?? "inconnu";
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
  const waLink = useWhatsAppUrl("Bonjour, je vous contacte depuis le site.");
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    { id: 0, from: "bot", text: "Bonjour, je suis l'assistant de MANGA PERFORMANCE. Posez-moi votre question ou choisissez un sujet ci-dessous." },
  ]);
  const nextId = useRef(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, typing]);

  const push = (...m: Omit<Msg, "id">[]) => setMessages((prev) => [...prev, ...m.map((x) => ({ ...x, id: nextId.current++ }))]);

  const reply = (intent: Intent): Omit<Msg, "id"> => {
    if (intent.startsWith("service:")) {
      const s = services.find((x) => x.slug === intent.slice(8))!;
      return { from: "bot", text: `${s.title} : ${s.short}`, links: [{ href: `/services/${s.slug}`, label: "Voir le détail" }, { href: "/contact", label: "Discuter de mon besoin" }] };
    }
    switch (intent as Exclude<Intent, `service:${string}`>) {
      case "services":
        return { from: "bot", text: "Nous accompagnons les entreprises sur quatre missions :", links: services.map((s) => ({ href: `/services/${s.slug}`, label: s.title })) };
      case "tarifs":
        // Règle métier : jamais de prix affiché, proposer d'être recontacté.
        return { from: "bot", text: "Chaque mission est chiffrée sur mesure selon votre besoin. Laissez-moi vos coordonnées pour recevoir une proposition adaptée.", form: true };
      case "delais":
        return { from: "bot", text: "Les délais dépendent de la mission et de la disponibilité de vos données. Un calendrier précis vous est proposé dès le premier échange.", links: [{ href: "/contact", label: "Prendre rendez-vous" }] };
      case "recontact":
        return { from: "bot", text: "Avec plaisir. Laissez-moi vos coordonnées, un consultant vous recontacte sous 24 h ouvrées.", form: true };
      case "whatsapp":
        return { from: "bot", text: "Vous pouvez nous écrire directement sur WhatsApp :", links: [{ href: waLink, label: "Ouvrir WhatsApp" }] };
      case "coordonnees":
        return { from: "bot", text: `Nous sommes à ${contactInfo.address}. Téléphone : ${contactInfo.phone}. Email : ${contactInfo.email}.`, links: [{ href: "/contact", label: "Page contact" }] };
      case "horaires":
        return { from: "bot", text: `${contactInfo.hours}. Hors horaires, laissez un message : un consultant vous répond sous 24 h ouvrées.` };
      case "demo":
        return { from: "bot", text: "Vous pouvez explorer un tableau de bord d'exemple (données fictives) :", links: [{ href: "/demo", label: "Voir la démo" }] };
      case "blog":
        return { from: "bot", text: "Retrouvez nos conseils de gestion et de pilotage sur le blog :", links: [{ href: "/blog", label: "Lire le blog" }] };
      case "bonjour":
        return { from: "bot", text: "Bonjour ! Comment puis-je vous aider ?" };
      case "merci":
        return { from: "bot", text: "Avec plaisir ! N'hésitez pas si vous avez d'autres questions." };
      case "aurevoir":
        return { from: "bot", text: "Merci de votre visite, à bientôt !" };
      default:
        return {
          from: "bot",
          text: "Je suis un assistant automatique et je n'ai pas bien compris. Choisissez un sujet ci-dessous, ou laissez vos coordonnées pour qu'un consultant vous réponde.",
          links: [{ href: "/contact", label: "Écrire au cabinet" }],
        };
    }
  };

  const ask = (text: string, intent: Intent) => {
    push({ from: "user", text });
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      push(reply(intent));
    }, 500);
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
          role="dialog"
          aria-label="Assistant MANGA PERFORMANCE"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          className="fixed bottom-36 right-4 z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
        >
          <header className="bg-primary px-4 py-3 text-primary-foreground">
            <p className="font-semibold">Assistant MANGA PERFORMANCE</p>
            <p className="text-xs text-slate-300">Réponses automatiques — un consultant vous recontacte sous 24 h ouvrées</p>
          </header>
          <div ref={logRef} role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {messages.map((m) => (
              <div key={m.id} className={m.from === "user" ? "text-right" : undefined}>
                <div className={m.from === "user" ? "inline-block rounded-lg bg-accent px-3 py-2 text-left text-accent-foreground" : "inline-block rounded-lg bg-muted px-3 py-2 text-left"}>
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
            {typing && <p className="text-xs text-muted-foreground">L&apos;assistant écrit…</p>}
          </div>
          <div role="group" aria-label="Choix rapides" className="flex flex-wrap gap-1.5 border-t border-border p-2">
            {OPTIONS.map((o) => (
              <button key={o.key} onClick={() => ask(o.label, o.key)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">
                {o.label}
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
              ask(text, detectIntent(text));
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
            <Button type="submit" size="sm" aria-label="Envoyer" disabled={!draft.trim() || typing}>
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
