import type { BlogPost } from "@/lib/types";
import { db, latency } from "./store";

export const listSequences = () => latency(() => [...db.sequences]);
export const getSequence = (id: string) =>
  latency(() => db.sequences.find((s) => s.id === id) ?? null);
export const listSubscribers = () => latency(() => [...db.subscribers]);
export const listBlogPosts = () => latency(() => [...db.blogPosts]);
export const getBlogPost = (idOrSlug: string) =>
  latency(() => db.blogPosts.find((b) => b.id === idOrSlug || b.slug === idOrSlug) ?? null);
export const publishedPosts = () =>
  latency(() => db.blogPosts.filter((b): b is BlogPost => b.status === "publie"));
