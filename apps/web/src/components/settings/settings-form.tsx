"use client";

import { useState } from "react";
import { BellRing, Building2, ExternalLink, FileText, MessageCircle, Receipt, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { getSettings, saveSettings, type Settings } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";
import { MissingBadge } from "@/components/shared/missing-badge";
import { TBD, services } from "@/lib/content/site";
import { FAQ_SLOTS } from "@/lib/content/public-profile";
import { isProvided } from "@/lib/content/provided";

const SECTIONS = [
  { id: "profil", label: "Profil du cabinet", icon: Building2 },
  { id: "pages", label: "Pages publiques", icon: FileText },
  { id: "relances", label: "Règles de relance", icon: BellRing },
  { id: "facturation", label: "Facturation", icon: Receipt },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
] as const;

function Section({ id, title, description, icon: Icon, children }: { id: string; title: string; description: string; icon: typeof Building2; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-xl border border-border p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 id={`${id}-title`} className="font-semibold text-primary">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Form({ initial }: { initial: Settings }) {
  const [saved, setSaved] = useState(initial);
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  const page = (slug: string) => s.publicPages.services[slug] ?? { caseStudy: { client: "", summary: "" }, faq: [] };
  const setPublic = (patch: Partial<Settings["publicPages"]>) => set("publicPages", { ...s.publicPages, ...patch });
  const setService = (slug: string, next: Settings["publicPages"]["services"][string]) => setPublic({ services: { ...s.publicPages.services, [slug]: next } });
  const setFaq = (slug: string, index: number, field: "question" | "answer", value: string) => {
    const faq = Array.from({ length: FAQ_SLOTS }, (_, i) => page(slug).faq[i] ?? { question: "", answer: "" });
    faq[index] = { ...faq[index]!, [field]: value };
    setService(slug, { ...page(slug), faq });
  };

  const vatError = Number.isNaN(s.vatPercent) || s.vatPercent < 0 || s.vatPercent > 100 ? "Saisissez un taux entre 0 et 100." : undefined;
  const whatsappLink = s.whatsappNumber ? `https://wa.me/${s.whatsappNumber}?text=${encodeURIComponent(s.whatsappMessage)}` : null;

  return (
    <form
      className="grid gap-8 lg:grid-cols-[200px_1fr]"
      onSubmit={async (e) => {
        e.preventDefault();
        if (vatError) return toast.error(vatError);
        setSaving(true);
        try {
          await saveSettings(s);
          setSaved(s);
          toast.success("Paramètres enregistrés");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Enregistrement impossible, réessayez.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <nav aria-label="Sections des paramètres" className="hidden lg:block">
        <ul className="sticky top-24 space-y-1 text-sm">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <a href={`#${id}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="max-w-3xl space-y-6">
        <Section id="profil" title="Profil du cabinet" description="Ces informations figurent sur vos factures et dans vos emails." icon={Building2}>
          <Field label="Nom" htmlFor="st-name"><Input id="st-name" value={s.cabinetName} onChange={(e) => set("cabinetName", e.target.value)} /></Field>
          <Field label="Adresse" htmlFor="st-address"><Input id="st-address" value={s.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Téléphone" htmlFor="st-phone"><Input id="st-phone" type="tel" value={s.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Email" htmlFor="st-email"><Input id="st-email" type="email" value={s.email} onChange={(e) => set("email", e.target.value)} /></Field>
          </div>
          <div>
            <p className="text-sm font-medium">Logo</p>
            {/* Téléversement simulé : seul le nom du fichier est conservé */}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label htmlFor="st-logo" className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-accent">
                {s.logoName ? "Changer le logo" : "Choisir un fichier"}
                <input id="st-logo" type="file" accept="image/*" className="sr-only" onChange={(e) => set("logoName", e.target.files?.[0]?.name ?? "")} />
              </label>
              <span className="text-sm text-muted-foreground">{s.logoName || "Aucun fichier choisi (PNG ou JPG)"}</span>
              {s.logoName && <Button type="button" variant="ghost" size="sm" onClick={() => set("logoName", "")}>Retirer</Button>}
            </div>
          </div>
        </Section>

        <Section id="pages" title="Pages publiques" description="Ce que le site public affiche. Un champ vide n'est pas affiché : le texte provisoire n'est visible que dans cet écran, avec le badge « Contenu manquant »." icon={FileText}>
          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-primary">Chiffres clés de l&apos;accueil</legend>
            {/* TODO(client): valeurs à confirmer. Le cahier des charges indiquait « 10+ ans ». */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Années d'expérience" htmlFor="kf-exp"><Input id="kf-exp" placeholder="10+" value={s.keyFigures.experience} onChange={(e) => set("keyFigures", { ...s.keyFigures, experience: e.target.value })} /></Field>
              <Field label="Missions réalisées" htmlFor="kf-missions"><Input id="kf-missions" placeholder="50+" value={s.keyFigures.missions} onChange={(e) => set("keyFigures", { ...s.keyFigures, missions: e.target.value })} /></Field>
              <Field label="Secteurs accompagnés" htmlFor="kf-sectors"><Input id="kf-sectors" placeholder="7" value={s.keyFigures.sectors} onChange={(e) => set("keyFigures", { ...s.keyFigures, sectors: e.target.value })} /></Field>
            </div>
            <p className="text-xs text-muted-foreground">Un nombre suivi d&apos;un signe, par exemple « 10+ ». Le compteur de l&apos;accueil se termine sur cette valeur. Un champ vide masque le chiffre.</p>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-primary">Mentions légales et confidentialité</legend>
            {([
              ["legalForm", "Forme juridique, RCCM, capital", "st-legal"],
              ["publicationDirector", "Directeur de la publication", "st-director"],
              ["host", "Hébergeur", "st-host"],
            ] as const).map(([key, label, id]) => (
              <Field key={key} label={label} htmlFor={id}>
                <Input id={id} placeholder={TBD} value={s.publicPages[key]} onChange={(e) => setPublic({ [key]: e.target.value })} />
                {!isProvided(s.publicPages[key]) && <MissingBadge className="mt-1" />}
              </Field>
            ))}
            <Field label="Texte juridique définitif de la politique de confidentialité" htmlFor="st-privacy">
              <Textarea id="st-privacy" className="min-h-24" placeholder={TBD} value={s.publicPages.privacyText} onChange={(e) => setPublic({ privacyText: e.target.value })} />
              {!isProvided(s.publicPages.privacyText) && <MissingBadge className="mt-1" />}
            </Field>
          </fieldset>

          {services.map((service) => {
            const content = page(service.slug);
            const caseMissing = !isProvided(content.caseStudy.client) || !isProvided(content.caseStudy.summary);
            return (
              <fieldset key={service.slug} className="space-y-3 rounded-lg border border-border p-3">
                <legend className="px-1 text-sm font-semibold text-primary">Page « {service.title} »</legend>
                <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                  <Field label="Cas client : client" htmlFor={`case-client-${service.slug}`}>
                    <Input id={`case-client-${service.slug}`} placeholder={TBD} value={content.caseStudy.client} onChange={(e) => setService(service.slug, { ...content, caseStudy: { ...content.caseStudy, client: e.target.value } })} />
                  </Field>
                  <Field label="Cas client : résumé" htmlFor={`case-summary-${service.slug}`}>
                    <Textarea id={`case-summary-${service.slug}`} className="min-h-16" placeholder={TBD} value={content.caseStudy.summary} onChange={(e) => setService(service.slug, { ...content, caseStudy: { ...content.caseStudy, summary: e.target.value } })} />
                  </Field>
                </div>
                {caseMissing && <MissingBadge />}
                <p className="pt-1 text-sm font-medium">FAQ (3 à 4 questions, données structurées pour les moteurs de recherche)</p>
                {Array.from({ length: FAQ_SLOTS }, (_, i) => {
                  const item = content.faq[i] ?? { question: "", answer: "" };
                  const missing = !isProvided(item.question) || !isProvided(item.answer);
                  return (
                    <div key={i} className="grid gap-2 sm:grid-cols-2">
                      <Field label={`Question ${i + 1}`} htmlFor={`faq-q-${service.slug}-${i}`}>
                        <Input id={`faq-q-${service.slug}-${i}`} placeholder={TBD} value={item.question} onChange={(e) => setFaq(service.slug, i, "question", e.target.value)} />
                      </Field>
                      <Field label={`Réponse ${i + 1}`} htmlFor={`faq-a-${service.slug}-${i}`}>
                        <Textarea id={`faq-a-${service.slug}-${i}`} className="min-h-10" placeholder={TBD} value={item.answer} onChange={(e) => setFaq(service.slug, i, "answer", e.target.value)} />
                      </Field>
                      {missing && <div className="sm:col-span-2"><MissingBadge /></div>}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
        </Section>

        <Section id="relances" title="Règles de relance" description="Rappels internes planifiés automatiquement après le premier contact avec un prospect." icon={BellRing}>
          {([["j7", "J+7", "une semaine après le premier contact"], ["j15", "J+15", "deux semaines après"], ["j30", "J+30", "un mois après"]] as const).map(([k, label, hint]) => (
            <label key={k} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted/50 has-checked:border-accent has-checked:bg-accent/10">
              <input type="checkbox" className="h-4 w-4 accent-[#1A2B4A]" checked={s.followUps[k]} onChange={(e) => set("followUps", { ...s.followUps, [k]: e.target.checked })} />
              <span>
                <span className="font-medium">Relance {label}</span>
                <span className="block text-xs text-muted-foreground">Un rappel {hint}</span>
              </span>
            </label>
          ))}
        </Section>

        <Section id="facturation" title="Facturation" description="Valeurs proposées par défaut à la création d'une facture." icon={Receipt}>
          <Field label="TVA par défaut (%)" htmlFor="st-vat" error={vatError}>
            <Input id="st-vat" type="number" step="0.5" className="max-w-32" value={Number.isNaN(s.vatPercent) ? "" : s.vatPercent} onChange={(e) => set("vatPercent", e.target.value === "" ? NaN : Number(e.target.value))} />
          </Field>
          <Field label="Mentions sur les factures" htmlFor="st-mentions"><Textarea id="st-mentions" value={s.invoiceMentions} onChange={(e) => set("invoiceMentions", e.target.value)} /></Field>
          <Field label="Coordonnées bancaires" htmlFor="st-bank"><Textarea id="st-bank" className="min-h-20" value={s.bankDetails} onChange={(e) => set("bankDetails", e.target.value)} /></Field>
        </Section>

        <Section id="whatsapp" title="WhatsApp" description="Le bouton WhatsApp du site ouvre une conversation avec ce numéro et ce message." icon={MessageCircle}>
          <Field label="Numéro WhatsApp (format international, sans +)" htmlFor="st-wanum">
            <Input id="st-wanum" inputMode="numeric" value={s.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Message prérempli" htmlFor="st-wa"><Textarea id="st-wa" className="min-h-20" value={s.whatsappMessage} onChange={(e) => set("whatsappMessage", e.target.value)} /></Field>
          {whatsappLink && (
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline hover:no-underline">
              <ExternalLink className="h-4 w-4" aria-hidden /> Tester le lien dans WhatsApp
            </a>
          )}
        </Section>

        {/* Barre d'enregistrement : toujours visible, elle dit s'il y a quelque chose à enregistrer. */}
        <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-2 py-3 backdrop-blur">
          <p role="status" className="mr-auto text-sm text-muted-foreground">
            {dirty ? <span className="font-medium text-warning">Modifications non enregistrées</span> : "Tout est enregistré"}
          </p>
          <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setS(saved)}>
            <Undo2 className="h-4 w-4" aria-hidden /> Annuler les modifications
          </Button>
          <Button type="submit" variant="accent" loading={saving} disabled={!dirty}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
        </div>
      </div>
    </form>
  );
}

export function SettingsForm() {
  const settings = useAsync(getSettings);
  if (settings.status === "loading") return <LoadingState />;
  if (settings.status === "error") return <ErrorState message="Paramètres indisponibles." onRetry={settings.reload} />;
  return <Form initial={settings.data} />;
}
