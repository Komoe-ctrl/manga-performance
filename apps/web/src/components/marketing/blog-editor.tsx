"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { createBlogPost, getBlogPost, updateBlogPost, type BlogDraft } from "@/lib/services";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { BlogPost } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

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
  const dialogRef = useRef<HTMLDialogElement>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initial.content,
    immediatelyRender: false,
    editorProps: { attributes: { class: "rich-text min-h-60 rounded-b-md border border-border p-3 focus:outline-none", "aria-label": "Contenu de l'article" } },
    onUpdate: ({ editor: e }) => setDraft((d) => ({ ...d, content: e.getHTML() })),
  });

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (preview && !d.open) d.showModal();
    if (!preview && d.open) d.close();
  }, [preview]);

  const set = <K extends keyof BlogDraft>(k: K, v: BlogDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSeo = (k: "metaTitle" | "metaDescription", v: string) => setDraft((d) => ({ ...d, seo: { ...d.seo, [k]: v } }));

  const save = async (status: BlogPost["status"]) => {
    if (draft.title.trim().length < 3) return toast.error("Le titre est requis");
    setSaving(true);
    const payload = { ...draft, status };
    if (id) await updateBlogPost(id, payload);
    else {
      const post = await createBlogPost(payload);
      router.replace(`/admin/blog/${post.id}`);
    }
    setSaving(false);
    setDraft(payload);
    toast.success(status === "publie" ? "Article publié" : "Brouillon enregistré");
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
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
        </div>
      </div>

      <aside className="space-y-4">
        <Field label="Catégorie" htmlFor="post-category">
          <Select id="post-category" value={draft.category} onChange={(e) => set("category", e.target.value as BlogPost["category"])}>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <div className="space-y-2">
          <label htmlFor="post-cover" className="text-sm font-medium">Image de couverture</label>
          <input
            id="post-cover"
            type="file"
            accept="image/*"
            className="block w-full text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) set("coverImage", URL.createObjectURL(file)); // aperçu local, aucun stockage
            }}
          />
          {draft.coverImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.coverImage} alt="Aperçu de la couverture" className="h-32 w-full rounded-md object-cover" />
          )}
        </div>
        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-primary">SEO</legend>
          <Field label="Meta title" htmlFor="seo-title">
            <Input id="seo-title" value={draft.seo.metaTitle ?? ""} onChange={(e) => setSeo("metaTitle", e.target.value)} />
          </Field>
          <Counter value={draft.seo.metaTitle?.length ?? 0} max={60} />
          <Field label="Meta description" htmlFor="seo-desc">
            <Textarea id="seo-desc" className="min-h-20" value={draft.seo.metaDescription ?? ""} onChange={(e) => setSeo("metaDescription", e.target.value)} />
          </Field>
          <Counter value={draft.seo.metaDescription?.length ?? 0} max={160} />
        </fieldset>
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => setPreview(true)}>Prévisualiser</Button>
          <Button variant="outline" disabled={saving} onClick={() => save("brouillon")}>Enregistrer le brouillon</Button>
          <Button variant="accent" disabled={saving} onClick={() => save("publie")}>Publier</Button>
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
  const post = useAsync(() => getBlogPost(id));
  if (post.status === "loading") return <LoadingState />;
  if (post.status === "error") return <ErrorState message="Article indisponible." onRetry={post.reload} />;
  if (!post.data) return <EmptyState message="Article introuvable." />;
  const { id: postId, slug: _slug, publishedAt: _publishedAt, ...draft } = post.data;
  void _slug;
  void _publishedAt;
  return <Editor key={postId} id={postId} initial={draft} />;
}
