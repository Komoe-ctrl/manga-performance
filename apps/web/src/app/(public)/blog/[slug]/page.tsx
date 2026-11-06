import type { Metadata } from "next";
import { ArticleView } from "@/components/public/blog";
import { Section } from "@/components/public/section";
import { getBlogPost, publishedPosts } from "@/lib/services";

export async function generateStaticParams() {
  return (await publishedPosts()).map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
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
