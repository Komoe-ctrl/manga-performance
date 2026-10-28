import type { MetadataRoute } from "next";

// TODO: domaine réel à fournir par le client
const BASE = "https://www.manga-performance.example";
const PATHS = ["", "/a-propos", "/services", "/references", "/blog", "/demo", "/contact"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((p) => ({ url: BASE + p }));
}
