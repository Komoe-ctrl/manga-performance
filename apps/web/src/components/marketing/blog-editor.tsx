"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Eye, FileCheck2, Heading2, ImagePlus, Italic, List, ListOrdered, Redo2, Save, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { createBlogPost, getBlogPostForEdit, updateBlogPost, type BlogDraft } from "@/lib/services";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { BlogPost } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/shared";

const EMPTY: BlogDraft = {
  title: "",
  excerpt: "",
  category: "controle_de_gestion",
  content: "",
  coverImage: undefined,
  status: "brouillon",
  seo: {},
};

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={cn("text-xs", value > max ? "text-danger" : "text-muted-foreground")} aria-live="polite">
      {value} / {max} caractères
    </span>
  );
}

const slugify = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const plainText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/s+/g, " ").trim();

function ToolbarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("rounded p-1.5 hover:bg-muted", active && "bg-accent text-accent-foreground")}
    >
      {children}
    </button>
  );
}

function Editor({ initial, id }: { initial: BlogDraft; id?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<BlogDraft>(initial);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initial);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const dirty = draft.title !== saved.title || draft.excerpt !== saved.excerpt || draft.category !== saved.category || draft.content !== saved.content || draft.coverImage !== saved.coverImage || JSON.stringify(draft.seo) !== JSON.stringify(saved.seo);

  // Leaving with unsaved work asks for confirmation.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const editor = useEditor({
    extensions: [StarterKit],
    // The TipTap document is the source of truth when the article comes from the database.
    content: (initial.contentJson as object | undefined) ?? initial.content,
    immediatelyRender: false,
    editorProps: { attributes: { class: "rich-text min-h-60 rounded-b-md border border-border p-3 focus:outline-none", "aria-label": "Contenu de l'article" } },
    onUpdate: ({ editor: e }) => setDraft((d) => ({ ...d, content: e.getHTML(), contentJson: e.getJSON() })),
  });

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (preview && !d.open) d.showModal();
    if (!preview && d.open) d.close();
  }, [preview]);

  const words = plainText(draft.content).split(" ").filter(Boolean).length;
  const set = <K extends keyof BlogDraft>(k: K, v: BlogDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSeo = (k: "metaTitle" | "metaDescription", v: string) => setDraft((d) => ({ ...d, seo: { ...d.seo, [k]: v } }));

  const save = async (status: BlogPost["status"]) => {
    if (draft.title.trim().length < 3) return toast.error("Le titre est requis");
    setSaving(true);
    const payload = { ...draft, status };
    try {
      if (id) await updateBlogPost(id, payload);
      else {
        const post = await createBlogPost(payload);
        router.replace(`/admin/blog/${post.id}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible, réessayez.");
      return;
    } finally {
      setSaving(false);
    }
    setDraft(payload);
    setSaved(payload);
    toast.success(status === "publie" ? "Article publié" : "Brouillon enregistré");
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge status={draft.status} />
          <span role="status" className={dirty ? "font-medium text-warning" : "text-muted-foreground"}>
            {dirty ? "Modifications non enregistrées" : "Tout est enregistré"}
          </span>
        </div>
        <Field label="Titre *" htmlFor="post-title">
          <Input id="post-title" value={draft.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Extrait" htmlFor="post-excerpt">
          <Textarea id="post-excerpt" className="min-h-20" value={draft.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium">Contenu</p>
          <div role="toolbar" aria-label="Mise en forme" className="flex flex-wrap gap-1 rounded-t-md border border-b-0 border-border bg-muted p-1">
            <ToolbarButton label="Gras" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Italique" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Titre de section" active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Liste à puces" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Liste numérotée" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Annuler" onClick={() => editor?.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Rétablir" onClick={() => editor?.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></ToolbarButton>
          </div>
          <EditorContent editor={editor} />
          <p className="mt-1 text-xs text-muted-foreground">
            {words} mot{words > 1 ? "s" : ""} · environ {Math.max(1, Math.round(words / 200))} min de lecture
          </p>
        </div>
      </div>

      <aside className="min-w-0 space-y-4">
        <Field label="Catégorie" htmlFor="post-category">
          <Select id="post-category" value={draft.category} onChange={(e) => set("category", e.target.value as BlogPost["category"])}>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium">Image de couverture</p>
          {draft.coverImage ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={draft.coverImage} alt="Aperçu de la couverture" className="h-32 w-full rounded-md object-cover" />
              <Button
                type="button"
                variant="danger"
                size="icon"
                aria-label="Retirer l'image de couverture"
                className="absolute right-2 top-2 bg-background/90"
                onClick={() => {
                  set("coverImage", undefined);
                  if (coverInput.current) coverInput.current.value = "";
                }}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ) : (
            <label htmlFor="post-cover" className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-within:ring-2 focus-within:ring-accent">
              <ImagePlus className="h-5 w-5" aria-hidden />
              Ajouter une image
              <span className="text-xs">PNG ou JPG</span>
            </label>
          )}
          <input
            ref={coverInput}
            id="post-cover"
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) set("coverImage", URL.createObjectURL(file)); // aperçu local, aucun stockage
            }}
          />
        </div>
        <fieldset className="min-w-0 space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-primary">SEO</legend>
          <Field label="Meta title" htmlFor="seo-title">
            <Input id="seo-title" value={draft.seo.metaTitle ?? ""} onChange={(e) => setSeo("metaTitle", e.target.value)} />
          </Field>
          <Counter value={draft.seo.metaTitle?.length ?? 0} max={60} />
          <Field label="Meta description" htmlFor="seo-desc">
            <Textarea id="seo-desc" className="min-h-20" value={draft.seo.metaDescription ?? ""} onChange={(e) => setSeo("metaDescription", e.target.value)} />
          </Field>
          <Counter value={draft.seo.metaDescription?.length ?? 0} max={160} />
          <div className="rounded-md border border-border bg-muted/40 p-3" aria-label="Aperçu dans Google">
            <p className="truncate text-xs text-success">manga-performance.example › blog › {slugify(draft.title) || "titre-de-l-article"}</p>
            <p className="truncate text-base font-medium text-[#1a0dab]">{draft.seo.metaTitle || draft.title || "Titre de l'article"}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{draft.seo.metaDescription || draft.excerpt || "La description apparaît ici dans les résultats de recherche."}</p>
          </div>
        </fieldset>
        <div className="sticky bottom-0 flex flex-col gap-2 bg-background/95 py-3 backdrop-blur">
          <Button variant="soft" onClick={() => setPreview(true)}><Eye className="h-4 w-4" aria-hidden /> Prévisualiser</Button>
          <Button variant="outline" loading={saving} onClick={() => save("brouillon")}><Save className="h-4 w-4" aria-hidden /> Enregistrer le brouillon</Button>
          <Button variant="accent" loading={saving} onClick={() => save("publie")}><FileCheck2 className="h-4 w-4" aria-hidden /> {draft.status === "publie" ? "Mettre à jour" : "Publier"}</Button>
        </div>
      </aside>

      <dialog ref={dialogRef} onClose={() => setPreview(false)} aria-labelledby="preview-title" className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-lg p-6 backdrop:bg-black/50">
        <p className="text-xs uppercase text-muted-foreground">Aperçu — {CATEGORY_LABELS[draft.category]}</p>
        <h2 id="preview-title" className="mt-1 text-2xl font-bold text-primary">{draft.title || "Sans titre"}</h2>
        {/* Contenu saisi par le consultant dans l'éditeur (maquette). */}
        <div className="rich-text mt-4" dangerouslySetInnerHTML={{ __html: draft.content || "<p>Aucun contenu.</p>" }} />
        <div className="mt-6 text-right"><Button onClick={() => setPreview(false)}>Fermer</Button></div>
      </dialog>
    </div>
  );
}

export function NewPostEditor() {
  return <Editor initial={EMPTY} />;
}

export function EditPostEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const post = useAsync(() => getBlogPostForEdit(id));
  if (post.status === "loading") return <LoadingState />;
  if (post.status === "error") return <ErrorState message="Article indisponible." onRetry={post.reload} />;
  if (!post.data) return <EmptyState message="Article introuvable." />;
  const { id: postId, slug: _slug, publishedAt: _publishedAt, ...draft } = post.data;
  void _slug;
  void _publishedAt;
  return <Editor key={postId} id={postId} initial={draft} />;
}
