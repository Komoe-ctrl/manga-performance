"use client";

import { PageHeader } from "@/components/shared";
import { MockOverview } from "@/components/shared/mock-overview";
import { listBlogPosts } from "@/lib/services";

export default function Page() {
  return (
    <>
      <PageHeader title="Blog" description="Écran détaillé prévu à l'étape 7." />
      <MockOverview loader={listBlogPosts} label="articles" render={(b) => `${b.title} — ${b.status}`} />
    </>
  );
}
