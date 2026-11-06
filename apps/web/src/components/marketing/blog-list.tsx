"use client";

import Link from "next/link";
import { useAsync } from "@/lib/hooks/use-async";
import { listBlogPosts } from "@/lib/services";
import { CATEGORY_LABELS } from "@/lib/constants";
import type { BlogPost } from "@/lib/types";
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

export function AdminBlogList() {
  const posts = useAsync(listBlogPosts);
  if (posts.status === "loading") return <LoadingState />;
  if (posts.status === "error") return <ErrorState message="Articles indisponibles." onRetry={posts.reload} />;
  return <DataTable data={posts.data} columns={columns} getRowId={(b) => b.id} caption="Articles du blog" emptyMessage="Aucun article pour l'instant." />;
}
