import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";
import { blogPosts } from "@/lib/mock/business";

export const metadata: Metadata = { title: "Article" };

export function generateStaticParams() {
  return blogPosts.map((b) => ({ slug: b.slug }));
}

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Article" description="Page article prévue à l'étape 2." />
    </div>
  );
}
