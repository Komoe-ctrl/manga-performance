import type { MetadataRoute } from "next";
import { services } from "@/lib/content/site";
import { publishedPosts } from "@/lib/services";

// TODO: domaine réel à fournir par le client
const BASE = "https://www.manga-performance.example";
const PATHS = ["", "/a-propos", "/services", "/references", "/blog", "/demo", "/contact"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await publishedPosts();
  return [
    ...PATHS,
    ...services.map((s) => `/services/${s.slug}`),
    ...posts.map((p) => `/blog/${p.slug}`),
  ].map((p) => ({ url: BASE + p }));
}
