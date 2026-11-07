import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BlogError, createBlogService, pathsToRevalidate } from "@/server/marketing/blog-service";
import { FileError } from "@/server/files/upload-service";
import { createUser, db, resetDatabase, shutdown } from "./helpers";
import { FILES, MemoryStorage } from "./memory-storage";

let storage: MemoryStorage;
let revalidated: string[][];
let clock: Date;
let adminId: string;

const service = () =>
  createBlogService({
    prisma: db(),
    storage,
    publicBaseUrl: "https://files.example.com/bucket/",
    revalidate: (paths) => void revalidated.push(paths),
    now: () => clock,
  });

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const input = (over: Record<string, unknown> = {}) => ({
  title: "Pilotez vos coûts : mode d'emploi",
  excerpt: "Un résumé.",
  category: "controle_de_gestion" as const,
  contentJson: doc("Premier paragraphe."),
  status: "brouillon" as const,
  ...over,
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BlogError || error instanceof FileError) return error;
    throw error;
  }
  throw new Error("expected an error");
};

beforeEach(async () => {
  await resetDatabase();
  storage = new MemoryStorage();
  revalidated = [];
  clock = new Date("2026-11-07T09:00:00Z");
  adminId = (await createUser({ role: "ADMIN" })).id;
});
afterAll(shutdown);

describe("saving an article", () => {
  it("stores the TipTap JSON and a sanitized HTML generated from it", async () => {
    const post = await service().save(input({ contentJson: doc("Texte avec <script>alert(1)</script> dedans") }), adminId);
    const row = await db().blogPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.contentJson).toEqual(doc("Texte avec <script>alert(1)</script> dedans"));
    expect(row.contentHtml).toBe("<p>Texte avec &lt;script&gt;alert(1)&lt;/script&gt; dedans</p>");
    expect(post).toMatchObject({ content: row.contentHtml, status: "brouillon", category: "controle_de_gestion" });
    expect(post.contentJson).toEqual(row.contentJson);
  });

  it("strips dangerous links, whatever the editor sent", async () => {
    const evil = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "clic", marks: [{ type: "link", attrs: { href: "javascript:alert(document.cookie)" } }] }] }] };
    const post = await service().save(input({ contentJson: evil }), adminId);
    expect(post.content).not.toContain("javascript");
  });

  it("refuses content that is not a TipTap document, or uses unknown nodes", async () => {
    expect((await failure(service().save(input({ contentJson: { type: "paragraph" } }), adminId))).code).toBe("INVALID");
    expect((await failure(service().save(input({ contentJson: { type: "doc", content: [{ type: "iframeEmbed" }] } }), adminId))).code).toBe("INVALID");
    expect(await db().blogPost.count()).toBe(0);
  });

  it("derives an excerpt when none is given", async () => {
    const post = await service().save(input({ excerpt: "  ", contentJson: doc("Début du texte. ".repeat(30)) }), adminId);
    expect(post.excerpt.length).toBeGreaterThan(20);
    expect(post.excerpt.length).toBeLessThanOrEqual(180);
  });

  it("transliterates the title into a unique slug", async () => {
    const first = await service().save(input(), adminId);
    const second = await service().save(input(), adminId);
    const third = await service().save(input({ title: "Éléphant & Œuf" }), adminId);
    expect([first.slug, second.slug, third.slug]).toEqual(["pilotez-vos-couts-mode-d-emploi", "pilotez-vos-couts-mode-d-emploi-2", "elephant-oeuf"]);
  });

  it("lets a draft's slug follow its title, but never changes a published address", async () => {
    const draft = await service().save(input({ title: "Premier titre" }), adminId);
    expect(draft.slug).toBe("premier-titre");
    const renamed = await service().save(input({ title: "Second titre" }), adminId, draft.id);
    expect(renamed.slug).toBe("second-titre");

    const published = await service().save(input({ title: "Second titre", status: "publie" }), adminId, draft.id);
    expect(published.slug).toBe("second-titre");
    const retitled = await service().save(input({ title: "Titre totalement différent", status: "publie" }), adminId, draft.id);
    expect(retitled.slug).toBe("second-titre");
    // Even after unpublishing: it was public once.
    const back = await service().save(input({ title: "Encore un autre", status: "brouillon" }), adminId, draft.id);
    expect(back.slug).toBe("second-titre");
  });

  it("does not collide with its own slug when saved again", async () => {
    const post = await service().save(input(), adminId);
    const again = await service().save(input(), adminId, post.id);
    expect(again.slug).toBe(post.slug);
  });

  it("keeps the first publication date, clears it on unpublish, and dates a re-publication anew", async () => {
    const post = await service().save(input({ status: "publie" }), adminId);
    expect(post.publishedAt).toBe(clock.toISOString());

    clock = new Date("2026-11-08T09:00:00Z");
    const edited = await service().save(input({ status: "publie", excerpt: "Modifié" }), adminId, post.id);
    expect(edited.publishedAt).toBe("2026-11-07T09:00:00.000Z");

    const draft = await service().save(input({ status: "brouillon" }), adminId, post.id);
    expect(draft.publishedAt).toBeUndefined();
    clock = new Date("2026-11-09T09:00:00Z");
    expect((await service().save(input({ status: "publie" }), adminId, post.id)).publishedAt).toBe("2026-11-09T09:00:00.000Z");
  });

  it("reports an unknown article, and stores SEO fields", async () => {
    expect((await failure(service().save(input(), adminId, "nope"))).code).toBe("NOT_FOUND");
    const post = await service().save(input({ metaTitle: "Titre SEO", metaDescription: "Description SEO" }), adminId);
    expect(post.seo).toEqual({ metaTitle: "Titre SEO", metaDescription: "Description SEO" });
  });

  it("audits creation, publication, update and unpublication", async () => {
    const post = await service().save(input(), adminId);
    await service().save(input({ status: "publie" }), adminId, post.id);
    await service().save(input({ status: "publie", excerpt: "x" }), adminId, post.id);
    await service().save(input({ status: "brouillon" }), adminId, post.id);
    const actions = (await db().auditLog.findMany({ where: { entityId: post.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["blog.created", "blog.published", "blog.updated", "blog.unpublished"]);
  });
});

describe("revalidation of the public site", () => {
  it("refreshes /blog, the article, the home page and the sitemap when an article is published", async () => {
    const post = await service().save(input({ status: "publie" }), adminId);
    expect(revalidated).toEqual([["/blog", `/blog/${post.slug}`, "/", "/sitemap.xml"]]);
    expect(revalidated[0]).toEqual(pathsToRevalidate(post.slug));
  });

  it("does nothing for drafts, but refreshes when a published article is edited, unpublished or deleted", async () => {
    const post = await service().save(input(), adminId);
    await service().save(input({ excerpt: "Toujours brouillon" }), adminId, post.id);
    expect(revalidated).toHaveLength(0);

    await service().save(input({ status: "publie" }), adminId, post.id);
    await service().save(input({ status: "publie", excerpt: "Édité" }), adminId, post.id);
    await service().save(input({ status: "brouillon" }), adminId, post.id);
    expect(revalidated).toHaveLength(3);

    await service().save(input({ status: "publie" }), adminId, post.id);
    revalidated = [];
    await service().remove(post.id, adminId);
    expect(revalidated).toEqual([pathsToRevalidate(post.slug)]);
  });

  it("does not refresh anything when deleting a draft", async () => {
    const post = await service().save(input(), adminId);
    await service().remove(post.id, adminId);
    expect(revalidated).toHaveLength(0);
  });
});

describe("what the public sees", () => {
  it("only lists published articles, newest first, and hides drafts and deleted ones", async () => {
    clock = new Date("2026-11-01T09:00:00Z");
    const older = await service().save(input({ title: "Ancien", status: "publie" }), adminId);
    clock = new Date("2026-11-05T09:00:00Z");
    const newer = await service().save(input({ title: "Récent", status: "publie" }), adminId);
    const draft = await service().save(input({ title: "Brouillon" }), adminId);
    const removed = await service().save(input({ title: "Supprimé", status: "publie" }), adminId);
    await service().remove(removed.id, adminId);

    expect((await service().listPublished()).map((p) => p.id)).toEqual([newer.id, older.id]);
    expect((await service().list()).map((p) => p.id).sort()).toEqual([newer.id, older.id, draft.id].sort());
  });

  it("serves a published article by slug or id, never a draft or a deleted one", async () => {
    const published = await service().save(input({ title: "Visible", status: "publie" }), adminId);
    const draft = await service().save(input({ title: "Secret" }), adminId);
    expect((await service().getPublished(published.slug))?.id).toBe(published.id);
    expect((await service().getPublished(published.id))?.id).toBe(published.id);
    expect(await service().getPublished(draft.slug)).toBeNull();
    expect(await service().getPublished(draft.id)).toBeNull();
    // The editor can still open the draft.
    expect((await service().get(draft.id))?.id).toBe(draft.id);

    await service().remove(published.id, adminId);
    expect(await service().getPublished(published.slug)).toBeNull();
    expect(await service().get(published.id)).toBeNull();
    expect((await failure(service().remove(published.id, adminId))).code).toBe("NOT_FOUND");
  });

  it("soft-deletes: the row stays for the audit trail", async () => {
    const post = await service().save(input({ status: "publie" }), adminId);
    await service().remove(post.id, adminId);
    expect(await db().blogPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: "DRAFT" });
    expect((await db().blogPost.findUniqueOrThrow({ where: { id: post.id } })).deletedAt).not.toBeNull();
  });
});

describe("cover images (the only public prefix)", () => {
  const png = new Uint8Array(Buffer.from(FILES.png, "latin1"));

  it("issues a presigned upload under public/blog/, for PNG and JPG only", async () => {
    const ticket = await service().requestCoverUpload({ filename: "Couverture.PNG", mimeType: "image/png", sizeBytes: png.length });
    expect(ticket.key).toMatch(/^public\/blog\/[A-Za-z0-9_-]{24}\.png$/);
    expect(storage.uploads).toMatchObject([{ key: ticket.key, contentType: "image/png", contentLength: png.length }]);
    expect((await service().requestCoverUpload({ filename: "a.jpeg", mimeType: "image/jpeg", sizeBytes: 10 })).key).toMatch(/\.jpg$/);

    for (const [filename, mimeType] of [["doc.pdf", "application/pdf"], ["t.xlsx", ""], ["n.docx", ""]] as const) {
      expect((await failure(service().requestCoverUpload({ filename, mimeType, sizeBytes: 10 }))).code).toBe("TYPE_NOT_ALLOWED");
    }
    expect((await failure(service().requestCoverUpload({ filename: "x.svg", mimeType: "image/svg+xml", sizeBytes: 10 }))).code).toBe("TYPE_NOT_ALLOWED");
  });

  it("attaches a verified image and exposes its public URL", async () => {
    const ticket = await service().requestCoverUpload({ filename: "c.png", mimeType: "", sizeBytes: png.length });
    storage.put(ticket.key, png);
    const post = await service().save(input({ coverKey: ticket.key }), adminId);
    expect(post.coverImage).toBe(`https://files.example.com/bucket/${ticket.key}`);
    // Saving again without a cover keeps it.
    expect((await service().save(input(), adminId, post.id)).coverImage).toBe(post.coverImage);
  });

  it("rejects, and deletes, a non-image uploaded as a cover", async () => {
    const ticket = await service().requestCoverUpload({ filename: "c.png", mimeType: "", sizeBytes: 50 });
    storage.put(ticket.key, FILES.exe);
    expect((await failure(service().save(input({ coverKey: ticket.key }), adminId))).code).toBe("INVALID_CONTENT");
    expect(storage.deleted).toContain(ticket.key);
    expect(await db().blogPost.count()).toBe(0);
  });

  it("rejects keys outside the public prefix, including a client's private file", async () => {
    storage.put("clients/c1/secret.png", png);
    for (const coverKey of ["clients/c1/secret.png", "public/blog/../clients/c1/secret.png", "public/blog/sub/x.png", "public/other/x.png", "public/blog/"]) {
      expect((await failure(service().save(input({ coverKey }), adminId))).code).toBe("INVALID_KEY");
    }
    expect(storage.objects.has("clients/c1/secret.png")).toBe(true);
  });

  it("rejects a cover that was never uploaded", async () => {
    expect((await failure(service().save(input({ coverKey: "public/blog/never-uploaded.png" }), adminId))).code).toBe("FILE_MISSING");
  });
});
