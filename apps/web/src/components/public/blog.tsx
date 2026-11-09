"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, MessageCircle, Search, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { getBlogPost, publishedPosts } from "@/lib/services";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { BlogPost } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { DateLabel, EmptyState, ErrorState, LoadingState } from "@/components/shared";

function PostCard({ post }: { post: BlogPost }) {
  return (
    <article className="card-lift flex flex-col rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-medium text-warning">{CATEGORY_LABELS[post.category]}</p>
      <h3 className="mt-1 font-bold text-primary">
        <Link href={`/blog/${post.slug}`} className="hover:underline">
          {post.title}
        </Link>
      </h3>
      <p className="mt-2 flex-1 text-sm text-muted-foreground">{post.excerpt}</p>
      {post.publishedAt && (
        <p className="mt-3 text-xs text-muted-foreground">
          <DateLabel value={post.publishedAt} />
        </p>
      )}
    </article>
  );
}

export function BlogList({ limit, filterable = false }: { limit?: number; filterable?: boolean }) {
  const posts = useAsync(publishedPosts);
  const [category, setCategory] = useState<BlogPost["category"] | "all">("all");
  const [query, setQuery] = useState("");

  if (posts.status === "loading") return <LoadingState />;
  if (posts.status === "error") return <ErrorState message="Impossible de charger les articles." onRetry={posts.reload} />;

  const shown = posts.data
    .filter((p) => category === "all" || p.category === category)
    .filter((p) => !query.trim() || (p.title + " " + p.excerpt).toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, limit);

  return (
    <div className="space-y-4">
      {filterable && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label="Rechercher un article"
            placeholder="Rechercher un article…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/25"
          />
        </div>
      )}
      {filterable && (
        <div role="group" aria-label="Filtrer par catégorie" className="flex flex-wrap gap-2">
          {(["all", ...Object.keys(CATEGORY_LABELS)] as const).map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => setCategory(c as typeof category)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                category === c ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted",
              )}
            >
              {c === "all" ? "Tous" : CATEGORY_LABELS[c as BlogPost["category"]]}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState message={query ? "Aucun article ne correspond à votre recherche." : "Aucun article dans cette catégorie."} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function RelatedPosts({ current }: { current: BlogPost }) {
  const posts = useAsync(publishedPosts);
  if (posts.status !== "success") return null;
  const others = posts.data.filter((p) => p.id !== current.id);
  const related = [...others.filter((p) => p.category === current.category), ...others.filter((p) => p.category !== current.category)].slice(0, 2);
  if (related.length === 0) return null;
  return (
    <section aria-labelledby="related-title" className="mt-12">
      <h2 id="related-title" className="mb-3 text-lg font-bold text-primary">À lire aussi</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {related.map((p) => <PostCard key={p.id} post={p} />)}
      </div>
    </section>
  );
}

export function ArticleView({ slug }: { slug: string }) {
  const post = useAsync(() => getBlogPost(slug));

  if (post.status === "loading") return <LoadingState />;
  if (post.status === "error") return <ErrorState message="Impossible de charger l'article." onRetry={post.reload} />;
  if (!post.data) return <EmptyState message="Article introuvable." />;

  const p = post.data;
  const url = typeof window === "undefined" ? "" : window.location.href;
  const words = p.content.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  const share = (href: string) => window.open(href, "_blank", "noopener,noreferrer");

  return (
    <article>
      <Link href="/blog" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Tous les articles
      </Link>
      <p className="text-sm font-medium text-warning">{CATEGORY_LABELS[p.category]}</p>
      <h1 className="mt-1 text-3xl font-bold text-primary">{p.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {p.publishedAt && (<>Publié le <DateLabel value={p.publishedAt} /> · </>)}
        {minutes} min de lecture
      </p>
      <div className="rich-text mt-6" dangerouslySetInnerHTML={{ __html: p.content }} />
      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className="text-sm">Partager :</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => share(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`)}
        >
          <Share2 className="h-4 w-4" aria-hidden /> LinkedIn
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => share(`https://wa.me/?text=${encodeURIComponent(`${p.title} ${url}`)}`)}
        >
          <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            toast.success("Lien copié");
          }}
        >
          <Copy className="h-4 w-4" aria-hidden /> Copier le lien
        </Button>
      </div>
      <div className="mt-10 rounded-xl bg-primary p-6 text-primary-foreground">
        <p className="font-semibold">Un point à éclaircir sur votre propre situation ?</p>
        <p className="mt-1 text-sm text-slate-200">Échangeons 30 minutes, sans engagement.</p>
        <Link href="/contact" className="mt-4 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-foreground transition-all hover:-translate-y-0.5">
          Prendre rendez-vous
        </Link>
      </div>
      <RelatedPosts current={p} />
    </article>
  );
}
