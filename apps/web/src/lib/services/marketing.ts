import type { BlogPost, EmailSequence, NewsletterSubscriber } from "@/lib/types";
import * as marketing from "@/server/actions/marketing";
import { ServiceError, USE_DB, unwrap } from "./data-source";

// TODO: à confirmer par le client — newsletter : envoi automatique de chaque nouvel article, ou envois manuels ?
import { db, latency, nextId } from "./store";

export const listSequences = (): Promise<EmailSequence[]> =>
  USE_DB ? unwrap(marketing.listSequencesAction()) : latency(() => [...db.sequences]);

export const getSequence = (id: string): Promise<EmailSequence | null> =>
  USE_DB ? unwrap(marketing.getSequenceAction(id)) : latency(() => db.sequences.find((s) => s.id === id) ?? null);

export const listSubscribers = (): Promise<NewsletterSubscriber[]> =>
  USE_DB ? unwrap(marketing.listSubscribersAction()) : latency(() => [...db.subscribers]);

export const listBlogPosts = (): Promise<BlogPost[]> =>
  USE_DB ? unwrap(marketing.listBlogPostsAction()) : latency(() => [...db.blogPosts]);

/**
 * The public site's reader: `DATA_SOURCE=db` only ever returns a *published* article, so
 * a draft cannot be reached by guessing its address. The editor uses `getBlogPostForEdit`.
 */
export const getBlogPost = (idOrSlug: string): Promise<BlogPost | null> =>
  USE_DB
    ? unwrap(marketing.getPublishedPostAction(idOrSlug))
    : latency(() => db.blogPosts.find((b) => b.id === idOrSlug || b.slug === idOrSlug) ?? null);

/** Back-office: any article, drafts included. */
export const getBlogPostForEdit = (id: string): Promise<BlogPost | null> =>
  USE_DB ? unwrap(marketing.getBlogPostForEditAction(id)) : latency(() => db.blogPosts.find((b) => b.id === id) ?? null);

export const publishedPosts = (): Promise<BlogPost[]> =>
  USE_DB ? unwrap(marketing.listPublishedPostsAction()) : latency(() => db.blogPosts.filter((b): b is BlogPost => b.status === "publie"));

export interface NewsletterProof {
  turnstileToken?: string;
  website?: string;
}

/**
 * Starts a double opt-in subscription. `DATA_SOURCE=db`: `POST /api/newsletter/subscribe`
 * (Turnstile, honeypot, rate limit); the answer is the same whether or not the address is
 * already known. `mock`: added as "not confirmed", as before.
 */
export const subscribeNewsletter = async (email: string, proof: NewsletterProof = {}): Promise<void> => {
  if (USE_DB) {
    let response: Response;
    try {
      response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent: true, ...proof }),
      });
    } catch {
      throw new ServiceError("Impossible de joindre le serveur. Vérifiez votre connexion.", "NETWORK");
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new ServiceError(body?.error ?? "Une erreur est survenue. Réessayez.", String(response.status));
    }
    return;
  }
  await latency(() => {
    if (db.subscribers.some((s) => s.email === email)) return;
    db.subscribers.unshift({
      id: nextId("s"),
      email,
      confirmed: false, // double opt-in : en attente de confirmation
      subscribedAt: new Date().toISOString(),
    });
  });
};

const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export type BlogDraft = Omit<BlogPost, "id" | "slug" | "publishedAt">;

/** What the server stores: the TipTap JSON is the source of truth, the HTML is generated server-side. */
const toServerInput = (input: BlogDraft) => ({
  title: input.title,
  excerpt: input.excerpt,
  category: input.category,
  contentJson: (input.contentJson as Record<string, unknown> | undefined) ?? { type: "doc", content: [] },
  status: input.status,
  metaTitle: input.seo.metaTitle,
  metaDescription: input.seo.metaDescription,
});

export const createBlogPost = (input: BlogDraft): Promise<BlogPost> =>
  USE_DB
    ? unwrap(marketing.saveBlogPostAction(null, toServerInput(input)))
    : latency(() => {
        const post: BlogPost = {
          ...input,
          id: nextId("b"),
          slug: slugify(input.title) || nextId("article-"),
          publishedAt: input.status === "publie" ? new Date().toISOString() : undefined,
        };
        db.blogPosts.unshift(post);
        return post;
      });

export const updateBlogPost = (id: string, input: BlogDraft): Promise<BlogPost> =>
  USE_DB
    ? unwrap(marketing.saveBlogPostAction(id, toServerInput(input)))
    : latency(() => {
        const post = db.blogPosts.find((b) => b.id === id);
        if (!post) throw new Error("Article introuvable");
        const wasPublished = post.status === "publie";
        Object.assign(post, input, {
          slug: slugify(input.title) || post.slug,
          publishedAt: input.status === "publie" ? (wasPublished ? post.publishedAt : new Date().toISOString()) : undefined,
        });
        return post;
      });

export const createSequence = (name: string): Promise<EmailSequence> =>
  USE_DB
    ? unwrap(marketing.createSequenceAction(name))
    : latency(() => {
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

export const updateSequence = (id: string, patch: Pick<EmailSequence, "name" | "trigger" | "active" | "steps">): Promise<EmailSequence> =>
  USE_DB
    ? unwrap(marketing.updateSequenceAction(id, patch))
    : latency(() => {
        const seq = db.sequences.find((s) => s.id === id);
        if (!seq) throw new Error("Séquence introuvable");
        Object.assign(seq, patch);
        return seq;
      });
