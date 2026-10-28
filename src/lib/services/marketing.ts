import type { BlogPost, EmailSequence } from "@/lib/types";

// TODO: à confirmer par le client — newsletter : envoi automatique de chaque nouvel article, ou envois manuels ?
import { db, latency, nextId } from "./store";

export const listSequences = () => latency(() => [...db.sequences]);
export const getSequence = (id: string) =>
  latency(() => db.sequences.find((s) => s.id === id) ?? null);
export const listSubscribers = () => latency(() => [...db.subscribers]);
export const listBlogPosts = () => latency(() => [...db.blogPosts]);
export const getBlogPost = (idOrSlug: string) =>
  latency(() => db.blogPosts.find((b) => b.id === idOrSlug || b.slug === idOrSlug) ?? null);
export const publishedPosts = () =>
  latency(() => db.blogPosts.filter((b): b is BlogPost => b.status === "publie"));

export const subscribeNewsletter = (email: string) =>
  latency(() => {
    const existing = db.subscribers.find((s) => s.email === email);
    if (existing) return existing;
    const sub = {
      id: nextId("s"),
      email,
      confirmed: false, // double opt-in : en attente de confirmation
      subscribedAt: new Date().toISOString(),
    };
    db.subscribers.unshift(sub);
    return sub;
  });

const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export type BlogDraft = Omit<BlogPost, "id" | "slug" | "publishedAt">;

export const createBlogPost = (input: BlogDraft) =>
  latency(() => {
    const post: BlogPost = {
      ...input,
      id: nextId("b"),
      slug: slugify(input.title) || nextId("article-"),
      publishedAt: input.status === "publie" ? new Date().toISOString() : undefined,
    };
    db.blogPosts.unshift(post);
    return post;
  });

export const updateBlogPost = (id: string, input: BlogDraft) =>
  latency(() => {
    const post = db.blogPosts.find((b) => b.id === id);
    if (!post) throw new Error("Article introuvable");
    const wasPublished = post.status === "publie";
    Object.assign(post, input, {
      slug: slugify(input.title) || post.slug,
      publishedAt: input.status === "publie" ? (wasPublished ? post.publishedAt : new Date().toISOString()) : undefined,
    });
    return post;
  });

export const createSequence = (name: string) =>
  latency(() => {
    const seq: EmailSequence = {
      id: nextId("seq"),
      name,
      trigger: "manuel",
      active: false,
      steps: [{ order: 1, delayDays: 0, subject: "", body: "" }],
      stats: { enrolled: 0, sent: 0, opened: 0, clicked: 0, unsubscribed: 0 },
    };
    db.sequences.push(seq);
    return seq;
  });

export const updateSequence = (id: string, patch: Pick<EmailSequence, "name" | "trigger" | "active" | "steps">) =>
  latency(() => {
    const seq = db.sequences.find((s) => s.id === id);
    if (!seq) throw new Error("Séquence introuvable");
    Object.assign(seq, patch);
    return seq;
  });
