"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useAsync } from "@/lib/hooks/use-async";
import { listBlogPosts } from "@/lib/services";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { BlogPost } from "@/lib/types";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";
import { DateLabel, ErrorState, LoadingState, StatusBadge } from "@/components/shared";
import { DataTable, type Column } from "@/components/shared/data-table";

const columns: Column<BlogPost>[] = [
  {
    id: "title",
    header: "Titre",
    sortValue: (b) => b.title,
    cell: (b) => <Link href={`/admin/blog/${b.id}`} className="font-medium hover:underline">{b.title}</Link>,
  },
  { id: "category", header: "Catégorie", sortValue: (b) => CATEGORY_LABELS[b.category], cell: (b) => CATEGORY_LABELS[b.category] },
  { id: "status", header: "Statut", sortValue: (b) => b.status, cell: (b) => <StatusBadge status={b.status} /> },
  { id: "publishedAt", header: "Publié le", sortValue: (b) => b.publishedAt ?? "", cell: (b) => (b.publishedAt ? <DateLabel value={b.publishedAt} /> : "—") },
];

type Filter = "all" | "publie" | "brouillon";

export function AdminBlogList() {
  const posts = useAsync(listBlogPosts);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(() => {
    if (posts.status !== "success") return [];
    const q = query.trim().toLowerCase();
    return posts.data.filter((b) => (filter === "all" || b.status === filter) && (!q || b.title.toLowerCase().includes(q)));
  }, [posts, query, filter]);

  if (posts.status === "loading") return <LoadingState />;
  if (posts.status === "error") return <ErrorState message="Articles indisponibles." onRetry={posts.reload} />;

  const count = (f: Filter) => posts.data.filter((b) => f === "all" || b.status === f).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Rechercher un article" placeholder="Rechercher un article…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div role="group" aria-label="Filtrer par statut" className="flex gap-2">
          {([["all", "Tous"], ["publie", "Publiés"], ["brouillon", "Brouillons"]] as const).map(([v, label]) => (
            <button
              key={v}
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
              className={cn("rounded-full border px-3 py-1 text-sm", filter === v ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted")}
            >
              {label} <span className="text-xs opacity-70">({count(v)})</span>
            </button>
          ))}
        </div>
      </div>
      <DataTable data={rows} columns={columns} getRowId={(b) => b.id} caption="Articles du blog" emptyMessage="Aucun article ne correspond." />
    </div>
  );
}
