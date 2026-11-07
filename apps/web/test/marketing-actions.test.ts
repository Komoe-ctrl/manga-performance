import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/server/actions/marketing";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";
import { MemoryStorage } from "./memory-storage";

const shared = vi.hoisted(() => ({ storage: undefined as unknown, revalidated: [] as string[] }));

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void shared.revalidated.push(path) }));
vi.mock("@/server/queue", () => ({
  getEnqueuer: async () => ({ enqueueEmail: async () => undefined, enqueueFanout: async () => undefined }),
}));
vi.mock("@/server/storage/object-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage/object-storage")>()),
  getStorage: () => shared.storage,
}));

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const post = (over: Record<string, unknown> = {}) => ({ title: "Un article", excerpt: "Résumé", category: "data", contentJson: doc("Contenu"), status: "brouillon", ...over });
const sequence = (over: Record<string, unknown> = {}) => ({ name: "S", trigger: "manuel", active: false, steps: [{ order: 1, delayDays: 0, subject: "Sujet", body: "Corps" }], ...over });

const adminActions: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
  ["listSequences", () => actions.listSequencesAction()],
  ["getSequence", () => actions.getSequenceAction("x")],
  ["createSequence", () => actions.createSequenceAction("Nom")],
  ["updateSequence", () => actions.updateSequenceAction("x", sequence())],
  ["enrollProspect", () => actions.enrollProspectAction({ sequenceId: "x", prospectId: "y" })],
  ["getMarketingSettings", () => actions.getMarketingSettingsAction()],
  ["saveMarketingSettings", () => actions.saveMarketingSettingsAction({ dailyCap: 10 })],
  ["listSubscribers", () => actions.listSubscribersAction()],
  ["listBlogPosts", () => actions.listBlogPostsAction()],
  ["getBlogPostForEdit", () => actions.getBlogPostForEditAction("x")],
  ["saveBlogPost", () => actions.saveBlogPostAction(null, post())],
  ["deleteBlogPost", () => actions.deleteBlogPostAction("x")],
  ["requestBlogCoverUpload", () => actions.requestBlogCoverUploadAction({ filename: "a.png", mimeType: "image/png", sizeBytes: 10 })],
];

let adminId: string;
let adminEmail: string;

async function asAdmin() {
  const { cookie } = await login(adminEmail);
  await db().user.update({ where: { id: adminId }, data: { twoFactorEnabled: true } });
  actAs(cookie);
}

beforeEach(async () => {
  await resetDatabase();
  await db().$executeRawUnsafe(`TRUNCATE TABLE "SequenceStep", "EmailSequence" CASCADE`);
  shared.storage = new MemoryStorage();
  shared.revalidated = [];
  actAs(null);
  const admin = await createUser({ role: "ADMIN" });
  adminId = admin.id;
  adminEmail = admin.email;
});
afterAll(shutdown);

describe("access control", () => {
  it.each(adminActions)("%s refuses anonymous visitors", async (_n, run) => {
    expect(await run()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(adminActions)("%s refuses a client", async (_n, run) => {
    const client = await createClientCompany("Acme");
    const user = await createUser({ role: "CLIENT", clientId: client.id });
    actAs((await login(user.email)).cookie);
    expect(await run()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it.each(adminActions)("%s refuses an admin without 2FA", async (_n, run) => {
    actAs((await login(adminEmail)).cookie);
    expect(await run()).toMatchObject({ ok: false, code: "TWO_FACTOR_REQUIRED" });
  });
});

describe("blog through actions", () => {
  it("publishes an article, refreshes the public pages, and makes it visible to anonymous visitors", async () => {
    await asAdmin();
    const saved = await actions.saveBlogPostAction(null, post({ status: "publie", title: "Mon premier article" }));
    expect(saved).toMatchObject({ ok: true, data: { slug: "mon-premier-article", status: "publie" } });
    expect(shared.revalidated).toEqual(["/blog", "/blog/mon-premier-article", "/", "/sitemap.xml"]);

    actAs(null); // a visitor, no session
    const list = await actions.listPublishedPostsAction();
    expect(list.ok && list.data.map((p) => p.slug)).toEqual(["mon-premier-article"]);
    expect(await actions.getPublishedPostAction("mon-premier-article")).toMatchObject({ ok: true, data: { title: "Mon premier article" } });
  });

  it("never shows drafts to the public, even by exact slug or id", async () => {
    await asAdmin();
    const draft = await actions.saveBlogPostAction(null, post({ title: "Secret" }));
    if (!draft.ok) throw new Error("setup failed");
    actAs(null);
    expect(await actions.getPublishedPostAction("secret")).toMatchObject({ ok: true, data: null });
    expect(await actions.getPublishedPostAction(draft.data.id)).toMatchObject({ ok: true, data: null });
    expect(await actions.listPublishedPostsAction()).toMatchObject({ ok: true, data: [] });
    // And a public request cannot reach the editor's reads.
    expect(await actions.getBlogPostForEditAction(draft.data.id)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("answers invalid content with a clear result", async () => {
    await asAdmin();
    expect(await actions.saveBlogPostAction(null, post({ contentJson: { type: "doc", content: [{ type: "scriptNode" }] } }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.saveBlogPostAction(null, post({ title: "" }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.saveBlogPostAction(null, post({ category: "politique" }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.saveBlogPostAction("nope", post())).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("edits, lists and deletes", async () => {
    await asAdmin();
    const saved = await actions.saveBlogPostAction(null, post());
    if (!saved.ok) throw new Error("setup failed");
    expect(await actions.saveBlogPostAction(saved.data.id, post({ excerpt: "Autre" }))).toMatchObject({ ok: true, data: { excerpt: "Autre" } });
    expect((await actions.getBlogPostForEditAction(saved.data.id)).ok).toBe(true);
    expect(await actions.listBlogPostsAction()).toMatchObject({ ok: true, data: [{ id: saved.data.id }] });
    expect(await actions.deleteBlogPostAction(saved.data.id)).toMatchObject({ ok: true, data: { deleted: true } });
    expect(await actions.listBlogPostsAction()).toMatchObject({ ok: true, data: [] });
  });

  it("issues cover uploads for images only", async () => {
    await asAdmin();
    expect(await actions.requestBlogCoverUploadAction({ filename: "c.jpg", mimeType: "image/jpeg", sizeBytes: 100 })).toMatchObject({ ok: true, data: { key: expect.stringMatching(/^public\/blog\//) } });
    expect(await actions.requestBlogCoverUploadAction({ filename: "c.pdf", mimeType: "application/pdf", sizeBytes: 100 })).toMatchObject({ ok: false, code: "TYPE_NOT_ALLOWED" });
  });
});

describe("sequences and subscribers through actions", () => {
  it("creates, edits, activates and lists a sequence, with readable errors", async () => {
    await asAdmin();
    const created = await actions.createSequenceAction("Bienvenue");
    if (!created.ok) throw new Error("setup failed");
    const id = created.data.id;

    const bad = await actions.updateSequenceAction(id, sequence({ steps: [{ order: 1, delayDays: 0, subject: "Salut {{nom}}", body: "x" }] }));
    expect(bad).toMatchObject({ ok: false, code: "INVALID", error: expect.stringContaining("{{nom}}") });
    expect(await actions.updateSequenceAction(id, sequence({ steps: [] }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.updateSequenceAction(id, sequence({ steps: [{ order: 1, delayDays: -1, subject: "s", body: "b" }] }))).toMatchObject({ ok: false, code: "INVALID" });

    expect(await actions.updateSequenceAction(id, sequence({ name: "Bienvenue v2", active: true, trigger: "inscription_newsletter" }))).toMatchObject({ ok: true, data: { name: "Bienvenue v2", active: true, trigger: "inscription_newsletter" } });
    expect(await actions.listSequencesAction()).toMatchObject({ ok: true, data: [{ id, active: true }] });
    expect(await actions.getSequenceAction("nope")).toMatchObject({ ok: true, data: null });
  });

  it("enrols a prospect and reports why it cannot", async () => {
    await asAdmin();
    const created = await actions.createSequenceAction("S");
    if (!created.ok) throw new Error("setup failed");
    await actions.updateSequenceAction(created.data.id, sequence({ active: true }));
    const prospect = await db().prospect.create({ data: { companyName: "P", companyNameNorm: "p", email: "p@example.com", sector: "x", source: "MANUEL" } });
    expect(await actions.enrollProspectAction({ sequenceId: created.data.id, prospectId: prospect.id })).toMatchObject({ ok: true });
    expect(await actions.enrollProspectAction({ sequenceId: created.data.id, prospectId: prospect.id })).toMatchObject({ ok: false, code: "ALREADY_ENROLLED" });
  });

  it("reads and saves the marketing settings, and lists subscribers", async () => {
    await asAdmin();
    expect(await actions.getMarketingSettingsAction()).toMatchObject({ ok: true, data: { dailyCap: 50 } });
    expect(await actions.saveMarketingSettingsAction({ dailyCap: 80 })).toMatchObject({ ok: true, data: { dailyCap: 80 } });
    expect(await actions.saveMarketingSettingsAction({ dailyCap: "lots" })).toMatchObject({ ok: false, code: "INVALID" });
    await db().newsletterSubscriber.create({ data: { email: "abonne@example.com", confirmedAt: new Date() } });
    expect(await actions.listSubscribersAction()).toMatchObject({ ok: true, data: [{ email: "abonne@example.com", confirmed: true }] });
  });
});
