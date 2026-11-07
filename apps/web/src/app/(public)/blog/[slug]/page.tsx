import type { Metadata } from "next";
import { ArticleView } from "@/components/public/blog";
import { Section } from "@/components/public/section";
import { USE_DB, getBlogPost, publishedPosts } from "@/lib/services";

/** With a real database, a build must not need it: articles are rendered on first visit instead. */
const skipDataAtBuild = () => USE_DB && process.env.NEXT_PHASE === "phase-production-build";

export async function generateStaticParams() {
  if (skipDataAtBuild()) return [{ slug: "article" }];
  try {
    const posts = await publishedPosts();
    if (posts.length > 0) return posts.map((b) => ({ slug: b.slug }));
  } catch {
    // A build must not depend on the database being reachable.
  }
  // Cache Components needs at least one param to validate the route. Real articles are rendered
  // on first visit, and refreshed by `revalidatePath` when they are published or edited.
  return [{ slug: "article" }];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (skipDataAtBuild()) return {};
  const post = await getBlogPost(slug).catch(() => null);
  if (!post) return {};
  const title = post.seo.metaTitle ?? post.title;
  const description = post.seo.metaDescription ?? post.excerpt;
  return { title, description, openGraph: { title, description, type: "article", locale: "fr_FR" } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        <ArticleView slug={slug} />
      </div>
    </Section>
  );
}
