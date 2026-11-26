"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import {
  deleteReference,
  deleteTestimonial,
  listReferences,
  listTestimonials,
  saveReference,
  saveTestimonial,
  uploadReferenceLogo,
  type ReferenceDraft,
  type TestimonialDraft,
} from "@/lib/services";
import type { ReferenceView, TestimonialView } from "@/lib/types/references";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, LoadingState, StatusBadge } from "@/components/shared";
import { DataTable, type Column } from "@/components/shared/data-table";

const message = (error: unknown) => (error instanceof Error ? error.message : "Enregistrement impossible.");

function Check({ id, checked, onChange, disabled, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className={`flex items-center gap-2 text-sm font-medium ${disabled ? "opacity-60" : ""}`}>
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
        {label}
      </label>
      {hint && <p className="pl-6 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const Authorization = ({ ok }: { ok: boolean }) => (
  <span className={ok ? "text-green-700" : "text-orange-700"}>{ok ? "Oui" : "Non"}</span>
);

// ---- références --------------------------------------------------------------------

const emptyReference: ReferenceDraft = { name: "", sector: "", description: "", url: "", displayOrder: 0, published: false, clientAuthorization: false, logoKey: null };

const toReferenceDraft = (r: ReferenceView): ReferenceDraft => ({
  name: r.name,
  sector: r.sector,
  description: r.description,
  url: r.url ?? "",
  displayOrder: r.displayOrder,
  published: r.published,
  clientAuthorization: r.clientAuthorization,
  logoKey: r.logoUrl ?? null,
});

function ReferenceForm({ initial, onDone }: { initial: ReferenceView | null; onDone: (changed: boolean) => void }) {
  const [draft, setDraft] = useState<ReferenceDraft>(initial ? toReferenceDraft(initial) : emptyReference);
  // On the server the logo key is stored; what the browser shows is its public address.
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.logoUrl ?? null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ReferenceDraft>(key: K, value: ReferenceDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // The logo is only sent when it changed: otherwise the server keeps the one it has.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveReference(initial?.id ?? null, { ...draft, logoKey: logoKey ?? (preview ? existingKey(initial) : null) });
      toast.success(initial ? "Référence enregistrée." : "Référence créée.");
      onDone(true);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-background p-4" aria-label={initial ? "Modifier la référence" : "Nouvelle référence"}>
      <h3 className="font-semibold text-primary">{initial ? `Modifier ${initial.name}` : "Nouvelle référence"}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nom" htmlFor="ref-name"><Input id="ref-name" required maxLength={120} value={draft.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Secteur" htmlFor="ref-sector"><Input id="ref-sector" required maxLength={80} value={draft.sector} onChange={(e) => set("sector", e.target.value)} /></Field>
      </div>
      <Field label="Description courte" htmlFor="ref-description">
        <Textarea id="ref-description" required maxLength={500} rows={3} value={draft.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Site web (facultatif)" htmlFor="ref-url"><Input id="ref-url" type="url" placeholder="https://" value={draft.url} onChange={(e) => set("url", e.target.value)} /></Field>
        <Field label="Ordre d'affichage" htmlFor="ref-order"><Input id="ref-order" type="number" min={0} max={9999} value={draft.displayOrder} onChange={(e) => set("displayOrder", Number(e.target.value))} /></Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Logo</p>
        {preview ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={`Logo de ${draft.name || "la référence"}`} className="h-16 w-auto max-w-48 rounded-md border border-border bg-white object-contain p-1" />
            <Button
              type="button"
              variant="danger"
              size="icon"
              aria-label="Retirer le logo"
              onClick={() => {
                setPreview(null);
                setLogoKey(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ) : (
          <label htmlFor="ref-logo" className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-within:ring-2 focus-within:ring-accent">
            <ImagePlus className="h-5 w-5" aria-hidden />
            Ajouter un logo
            <span className="text-xs">PNG ou JPG. Sans logo, le nom est affiché à la place.</span>
          </label>
        )}
        <input
          ref={fileInput}
          id="ref-logo"
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const uploaded = await uploadReferenceLogo(file);
              setLogoKey(uploaded.key);
              setPreview(uploaded.previewUrl);
            } catch (error) {
              toast.error(message(error));
              e.target.value = "";
            }
          }}
        />
      </div>

      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold text-primary">Publication</legend>
        <Check
          id="ref-authorization"
          checked={draft.clientAuthorization}
          onChange={(v) => setDraft((d) => ({ ...d, clientAuthorization: v, published: v ? d.published : false }))}
          label="Le client autorise la citation de son nom et de son logo"
          hint="Obligatoire pour publier. Retirer l'autorisation dépublie la référence."
        />
        <Check
          id="ref-published"
          checked={draft.published}
          disabled={!draft.clientAuthorization}
          onChange={(v) => set("published", v)}
          label="Publiée sur le site"
          hint={draft.clientAuthorization ? undefined : "Cochez d'abord l'autorisation du client."}
        />
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="accent" loading={busy}>Enregistrer</Button>
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>Annuler</Button>
      </div>
    </form>
  );
}

/** The key the server already holds for this reference: the logo is only re-sent when it was replaced. */
function existingKey(initial: ReferenceView | null): string | null {
  const url = initial?.logoUrl;
  if (!url) return null;
  const at = url.indexOf("public/references/");
  // `mock`: the local preview address is itself the key.
  return at >= 0 ? url.slice(at) : url;
}

// ---- témoignages -------------------------------------------------------------------

function TestimonialForm({ initial, references, onDone }: { initial: TestimonialView | null; references: ReferenceView[]; onDone: (changed: boolean) => void }) {
  const [draft, setDraft] = useState<TestimonialDraft>(
    initial
      ? { quote: initial.quote, author: initial.author, authorRole: initial.authorRole, referenceId: initial.referenceId, published: initial.published, writtenAuthorization: initial.writtenAuthorization }
      : { quote: "", author: "", authorRole: "", referenceId: references[0]?.id ?? "", published: false, writtenAuthorization: false },
  );
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TestimonialDraft>(key: K, value: TestimonialDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-background p-4"
      aria-label={initial ? "Modifier le témoignage" : "Nouveau témoignage"}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await saveTestimonial(initial?.id ?? null, draft);
          toast.success(initial ? "Témoignage enregistré." : "Témoignage créé.");
          onDone(true);
        } catch (error) {
          toast.error(message(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-semibold text-primary">{initial ? "Modifier le témoignage" : "Nouveau témoignage"}</h3>
      <Field label="Citation" htmlFor="tm-quote"><Textarea id="tm-quote" required maxLength={800} rows={4} value={draft.quote} onChange={(e) => set("quote", e.target.value)} /></Field>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Auteur" htmlFor="tm-author"><Input id="tm-author" required maxLength={120} value={draft.author} onChange={(e) => set("author", e.target.value)} /></Field>
        <Field label="Fonction" htmlFor="tm-role"><Input id="tm-role" required maxLength={120} value={draft.authorRole} onChange={(e) => set("authorRole", e.target.value)} /></Field>
        <Field label="Entreprise" htmlFor="tm-reference">
          <Select id="tm-reference" required value={draft.referenceId} onChange={(e) => set("referenceId", e.target.value)}>
            {references.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
      </div>
      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold text-primary">Publication</legend>
        <Check
          id="tm-authorization"
          checked={draft.writtenAuthorization}
          onChange={(v) => setDraft((d) => ({ ...d, writtenAuthorization: v, published: v ? d.published : false }))}
          label="J'ai l'autorisation écrite de l'auteur"
          hint="Obligatoire pour publier. L'entreprise citée doit aussi avoir donné son autorisation."
        />
        <Check id="tm-published" checked={draft.published} disabled={!draft.writtenAuthorization} onChange={(v) => set("published", v)} label="Publié sur le site" hint={draft.writtenAuthorization ? undefined : "Cochez d'abord l'autorisation écrite."} />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="accent" loading={busy}>Enregistrer</Button>
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>Annuler</Button>
      </div>
    </form>
  );
}

// ---- écran ------------------------------------------------------------------------

type Editing = { kind: "reference"; item: ReferenceView | null } | { kind: "testimonial"; item: TestimonialView | null } | null;

export function ReferencesAdmin() {
  const [version, setVersion] = useState(0);
  const references = useAsync(listReferences, [version]);
  const testimonials = useAsync(listTestimonials, [version]);
  const [editing, setEditing] = useState<Editing>(null);

  if (references.status === "loading" || testimonials.status === "loading") return <LoadingState />;
  if (references.status === "error" || testimonials.status === "error") {
    return <ErrorState message="Références indisponibles." onRetry={() => setVersion((v) => v + 1)} />;
  }
  const refs = references.data;
  const done = (changed: boolean) => {
    setEditing(null);
    if (changed) setVersion((v) => v + 1);
  };
  const remove = async (kind: "reference" | "testimonial", id: string, label: string) => {
    if (!window.confirm(`Supprimer « ${label} » ? Il disparaît aussi du site.`)) return;
    try {
      await (kind === "reference" ? deleteReference(id) : deleteTestimonial(id));
      toast.success("Supprimé.");
      setVersion((v) => v + 1);
    } catch (error) {
      toast.error(message(error));
    }
  };

  const refColumns: Column<ReferenceView>[] = [
    {
      id: "name",
      header: "Nom",
      sortValue: (r) => r.name,
      cell: (r) => (
        <button type="button" className="flex items-center gap-2 font-medium hover:underline" onClick={() => setEditing({ kind: "reference", item: r })}>
          {r.logoUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.logoUrl} alt="" className="h-6 w-auto max-w-16 object-contain" />
            </>
          )}
          {r.name}
        </button>
      ),
    },
    { id: "sector", header: "Secteur", sortValue: (r) => r.sector, cell: (r) => r.sector },
    { id: "order", header: "Ordre", sortValue: (r) => r.displayOrder, cell: (r) => r.displayOrder },
    { id: "auth", header: "Autorisation client", sortValue: (r) => String(r.clientAuthorization), cell: (r) => <Authorization ok={r.clientAuthorization} /> },
    { id: "logo", header: "Logo", sortValue: (r) => String(!!r.logoUrl), cell: (r) => (r.logoUrl ? "Oui" : <span className="text-orange-700">Manquant</span>) },
    { id: "status", header: "Statut", sortValue: (r) => String(r.published), cell: (r) => <StatusBadge status={r.published ? "publie" : "brouillon"} /> },
    {
      id: "actions",
      header: "",
      sortValue: () => "",
      cell: (r) => (
        <Button type="button" variant="ghost" size="icon" aria-label={`Supprimer ${r.name}`} onClick={() => remove("reference", r.id, r.name)}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      ),
    },
  ];
  const testimonialColumns: Column<TestimonialView>[] = [
    {
      id: "author",
      header: "Auteur",
      sortValue: (t) => t.author,
      cell: (t) => (
        <button type="button" className="text-left font-medium hover:underline" onClick={() => setEditing({ kind: "testimonial", item: t })}>
          {t.author}
          <span className="block text-xs font-normal text-muted-foreground">{t.authorRole}</span>
        </button>
      ),
    },
    { id: "company", header: "Entreprise", sortValue: (t) => t.company, cell: (t) => t.company },
    { id: "quote", header: "Citation", sortValue: (t) => t.quote, cell: (t) => <span className="line-clamp-2 max-w-md text-sm text-muted-foreground">{t.quote}</span> },
    { id: "auth", header: "Autorisation écrite", sortValue: (t) => String(t.writtenAuthorization), cell: (t) => <Authorization ok={t.writtenAuthorization} /> },
    { id: "status", header: "Statut", sortValue: (t) => String(t.published), cell: (t) => <StatusBadge status={t.published ? "publie" : "brouillon"} /> },
    {
      id: "actions",
      header: "",
      sortValue: () => "",
      cell: (t) => (
        <Button type="button" variant="ghost" size="icon" aria-label={`Supprimer le témoignage de ${t.author}`} onClick={() => remove("testimonial", t.id, t.author)}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-10">
      <p role="note" className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
        Rien n&apos;apparaît sur le site sans l&apos;autorisation cochée. Tant qu&apos;aucun témoignage n&apos;est publié, la section Témoignages est masquée.
      </p>

      <section aria-label="Références" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">Références ({refs.length})</h2>
          <Button type="button" variant="accent" onClick={() => setEditing({ kind: "reference", item: null })}>Nouvelle référence</Button>
        </div>
        {editing?.kind === "reference" && <ReferenceForm key={editing.item?.id ?? "new"} initial={editing.item} onDone={done} />}
        <DataTable data={refs} columns={refColumns} getRowId={(r) => r.id} caption="Références clients" emptyMessage="Aucune référence." />
      </section>

      <section aria-label="Témoignages" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">Témoignages ({testimonials.data.length})</h2>
          <Button type="button" variant="accent" disabled={refs.length === 0} onClick={() => setEditing({ kind: "testimonial", item: null })}>Nouveau témoignage</Button>
        </div>
        {refs.length === 0 && <p className="text-sm text-muted-foreground">Créez d&apos;abord une référence : un témoignage lui est rattaché.</p>}
        {editing?.kind === "testimonial" && <TestimonialForm key={editing.item?.id ?? "new"} initial={editing.item} references={refs} onDone={done} />}
        <DataTable data={testimonials.data} columns={testimonialColumns} getRowId={(t) => t.id} caption="Témoignages" emptyMessage="Aucun témoignage." />
      </section>
    </div>
  );
}
