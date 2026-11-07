import { slugify, uniqueSlug } from "@manga/core";
import { htmlToText, RichTextError, tiptapToHtml } from "@manga/core/rich-text";
import type { Prisma, PrismaClient } from "@manga/db";
import type { BlogPostInput } from "@manga/validation";
import type { BlogPost } from "@/lib/types";
import { DomainError } from "../domain-error";
import { createUploadService, type UploadTicket } from "../files/upload-service";
import { recordAudit } from "../repositories/audit";
import type { ObjectStorage } from "../storage/object-storage";

export class BlogError extends DomainError {
  constructor(code: "NOT_FOUND" | "INVALID", message: string) {
    super(code, message);
    this.name = "BlogError";
  }
}

export interface BlogDeps {
  prisma: PrismaClient;
  storage: ObjectStorage;
  /** Where `public/blog/*` is served from (bucket public URL). */
  publicBaseUrl: string;
  /** Refreshes the cached public pages (`revalidatePath` in production). */
  revalidate: (paths: string[]) => void;
  now?: () => Date;
}

type Row = Prisma.BlogPostGetPayload<object>;

/** Public pages affected by a post: the list, the post, the home page and the sitemap (spec, 6.8). */
export const pathsToRevalidate = (slug: string) => ["/blog", `/blog/${slug}`, "/", "/sitemap.xml"];

/**
 * Blog (spec, 6.8). The TipTap JSON is the source of truth; the HTML is generated from it
 * and sanitized every time the article is saved, so what the public sees is always clean.
 */
export function createBlogService({ prisma, storage, publicBaseUrl, revalidate, now = () => new Date() }: BlogDeps) {
  const uploads = createUploadService({ storage });
  const base = publicBaseUrl.replace(/\/$/, "");

  const toFront = (row: Row): BlogPost => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    category: row.category as BlogPost["category"],
    content: row.contentHtml,
    contentJson: row.contentJson,
    coverImage: row.coverKey ? `${base}/${row.coverKey}` : undefined,
    status: row.status === "PUBLISHED" ? "publie" : "brouillon",
    publishedAt: row.publishedAt?.toISOString(),
    seo: { metaTitle: row.metaTitle ?? undefined, metaDescription: row.metaDescription ?? undefined },
  });

  const byIdOrSlug = (idOrSlug: string): Prisma.BlogPostWhereInput => ({ deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] });

  return {
    // ---- back-office ----------------------------------------------------------------

    async list(): Promise<BlogPost[]> {
      const rows = await prisma.blogPost.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
      return rows.map(toFront);
    },

    async get(idOrSlug: string): Promise<BlogPost | null> {
      const row = await prisma.blogPost.findFirst({ where: byIdOrSlug(idOrSlug) });
      return row ? toFront(row) : null;
    },

    /** Creates (no `id`) or updates an article. */
    async save(input: BlogPostInput, actorId: string, id?: string): Promise<BlogPost> {
      let html: string;
      try {
        html = tiptapToHtml(input.contentJson);
      } catch (error) {
        if (error instanceof RichTextError) throw new BlogError("INVALID", error.message);
        throw error;
      }
      const excerpt = input.excerpt?.trim() || htmlToText(html).slice(0, 180);
      const existing = id ? await prisma.blogPost.findFirst({ where: { id, deletedAt: null } }) : null;
      if (id && !existing) throw new BlogError("NOT_FOUND", "Article introuvable.");

      if (input.coverKey && input.coverKey !== existing?.coverKey) await uploads.verifyPublicImage(input.coverKey);

      const slugTaken = async (candidate: string) =>
        (await prisma.blogPost.count({ where: { slug: candidate, ...(existing ? { id: { not: existing.id } } : {}) } })) > 0;
      // A published address never changes (links, search engines): only drafts follow the title.
      const slug =
        existing && (existing.publishedAt || existing.title === input.title)
          ? existing.slug
          : await uniqueSlug(slugify(input.title), slugTaken);

      const publishing = input.status === "publie";
      const at = now();
      const data = {
        slug,
        title: input.title.trim(),
        excerpt,
        category: input.category,
        contentJson: input.contentJson as Prisma.InputJsonValue,
        contentHtml: html,
        coverKey: input.coverKey ?? existing?.coverKey ?? null,
        status: publishing ? "PUBLISHED" : "DRAFT",
        publishedAt: publishing ? (existing?.status === "PUBLISHED" && existing.publishedAt ? existing.publishedAt : at) : null,
        metaTitle: input.metaTitle ?? null,
        metaDescription: input.metaDescription ?? null,
      };

      const row = existing
        ? await prisma.blogPost.update({ where: { id: existing.id }, data })
        : await prisma.blogPost.create({ data });
      const action = !existing ? "blog.created" : publishing && existing.status !== "PUBLISHED" ? "blog.published" : !publishing && existing.status === "PUBLISHED" ? "blog.unpublished" : "blog.updated";
      await recordAudit(prisma, { actorId, action, entity: "BlogPost", entityId: row.id, diff: { slug } });

      // Anything that touches a published page, now or before, must refresh the public site.
      if (publishing || existing?.status === "PUBLISHED") {
        revalidate([...new Set([...pathsToRevalidate(slug), ...(existing && existing.slug !== slug ? pathsToRevalidate(existing.slug) : [])])]);
      }
      return toFront(row);
    },

    /** Soft delete (spec, section 3). The address stops resolving immediately. */
    async remove(id: string, actorId: string): Promise<void> {
      const existing = await prisma.blogPost.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new BlogError("NOT_FOUND", "Article introuvable.");
      await prisma.blogPost.update({ where: { id }, data: { deletedAt: now(), status: "DRAFT" } });
      await recordAudit(prisma, { actorId, action: "blog.deleted", entity: "BlogPost", entityId: id });
      if (existing.status === "PUBLISHED") revalidate(pathsToRevalidate(existing.slug));
    },

    /** Presigned upload of a cover image to the public prefix (PNG or JPG only). */
    requestCoverUpload: (input: { filename: string; mimeType: string; sizeBytes: number }): Promise<UploadTicket> =>
      uploads.requestPublicImageUpload(input),

    // ---- public site ----------------------------------------------------------------

    async listPublished(): Promise<BlogPost[]> {
      const rows = await prisma.blogPost.findMany({ where: { deletedAt: null, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" } });
      return rows.map(toFront);
    },

    /** Only published articles: drafts are invisible to the public whatever they ask for. */
    async getPublished(idOrSlug: string): Promise<BlogPost | null> {
      const row = await prisma.blogPost.findFirst({ where: { ...byIdOrSlug(idOrSlug), status: "PUBLISHED" } });
      return row ? toFront(row) : null;
    },
  };
}

export type BlogService = ReturnType<typeof createBlogService>;
