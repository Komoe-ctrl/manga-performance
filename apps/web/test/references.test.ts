import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedStarterReference } from "@manga/db/references";
import { referenceInputSchema, testimonialInputSchema } from "@manga/validation";
import { DomainError } from "@/server/domain-error";
import { FileError } from "@/server/files/upload-service";
import { createReferencesService, REFERENCE_PATHS } from "@/server/references/references-service";
import { createUser, db, resetDatabase, shutdown } from "./helpers";
import { FILES, MemoryStorage } from "./memory-storage";

let storage: MemoryStorage;
let revalidated: string[][];
let adminId: string;

const service = () =>
  createReferencesService({ prisma: db(), storage, publicBaseUrl: "https://files.example.com/bucket/", revalidate: (paths) => void revalidated.push(paths) });

const ref = (over: Record<string, unknown> = {}) =>
  referenceInputSchema.parse({ name: "Hôtel Exemple", sector: "Hôtellerie", description: "Une description courte.", published: false, clientAuthorization: false, ...over });
const quote = (referenceId: string, over: Record<string, unknown> = {}) =>
  testimonialInputSchema.parse({ quote: "Un accompagnement précieux.", author: "A. Martin", authorRole: "Directrice", referenceId, published: false, writtenAuthorization: false, ...over });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError || error instanceof FileError) return error;
    throw error;
  }
  throw new Error("expected an error");
};

/** The logo as the browser leaves it: uploaded to the public prefix, then attached on save. */
async function uploadLogo(content: string = FILES.png) {
  const ticket = await service().requestLogoUpload({ filename: "logo.png", mimeType: "image/png", sizeBytes: content.length });
  storage.put(ticket.key, content);
  return ticket.key;
}

beforeEach(async () => {
  await resetDatabase();
  storage = new MemoryStorage();
  revalidated = [];
  adminId = (await createUser({ role: "ADMIN" })).id;
});
afterAll(shutdown);

describe("publishing a reference", () => {
  it("refuses to publish without the client's authorization, with a clear message", async () => {
    const error = await failure(service().saveReference(ref({ published: true }), adminId));
    expect(error).toMatchObject({ code: "VALIDATION" });
    expect(error.message).toMatch(/autorisation du client/);
    expect(await db().reference.count()).toBe(0);
  });

  it("publishes once authorized, audits it, and refreshes the public pages", async () => {
    const saved = await service().saveReference(ref({ published: true, clientAuthorization: true }), adminId);
    expect(saved).toMatchObject({ name: "Hôtel Exemple", published: true, clientAuthorization: true });
    expect(revalidated).toEqual([REFERENCE_PATHS]);
    expect(await db().auditLog.findFirstOrThrow({ where: { action: "reference.created", entityId: saved.id } })).toMatchObject({ actorId: adminId, diff: { published: true, clientAuthorization: true } });
    // Publishing a draft later is its own event.
    const draft = await service().saveReference(ref({ name: "Plus tard", clientAuthorization: true }), adminId);
    await service().saveReference(ref({ name: "Plus tard", clientAuthorization: true, published: true }), adminId, draft.id);
    expect(await db().auditLog.count({ where: { action: "reference.published", entityId: draft.id } })).toBe(1);
  });

  it("does not refresh the public site for a draft that was never public", async () => {
    await service().saveReference(ref(), adminId);
    expect(revalidated).toEqual([]);
  });

  it("keeps the order: display order, then name; and unpublishes without losing the reference", async () => {
    const b = await service().saveReference(ref({ name: "B", displayOrder: 2, published: true, clientAuthorization: true }), adminId);
    await service().saveReference(ref({ name: "A", displayOrder: 2, published: true, clientAuthorization: true }), adminId);
    await service().saveReference(ref({ name: "C", displayOrder: 1, published: true, clientAuthorization: true }), adminId);
    expect((await service().listPublicReferences()).map((r) => r.name)).toEqual(["C", "A", "B"]);

    await service().saveReference(ref({ name: "B", displayOrder: 2, published: false, clientAuthorization: true }), adminId, b.id);
    expect((await service().listPublicReferences()).map((r) => r.name)).toEqual(["C", "A"]);
    expect((await service().listReferences()).map((r) => r.name)).toEqual(["C", "A", "B"]);
  });

  it("refuses a duplicate name (whatever the case) and an unknown reference", async () => {
    await service().saveReference(ref({ name: "Hôtel Exemple" }), adminId);
    expect(await failure(service().saveReference(ref({ name: "hôtel exemple" }), adminId))).toMatchObject({ code: "DUPLICATE" });
    expect(await failure(service().saveReference(ref(), adminId, "nope"))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("never gives the public a draft, an unauthorized reference, a deleted one, or any internal flag", async () => {
    await service().saveReference(ref({ name: "Brouillon" }), adminId);
    await service().saveReference(ref({ name: "Autorisée, non publiée", clientAuthorization: true }), adminId);
    const gone = await service().saveReference(ref({ name: "Supprimée", published: true, clientAuthorization: true }), adminId);
    await service().removeReference(gone.id, adminId);
    const visible = await service().saveReference(ref({ name: "Visible", published: true, clientAuthorization: true }), adminId);

    const list = await service().listPublicReferences();
    expect(list.map((r) => r.name)).toEqual(["Visible"]);
    expect(Object.keys(list[0]!).sort()).toEqual(["description", "id", "logoUrl", "name", "sector", "url"].sort().filter((k) => k in list[0]!));
    expect(JSON.stringify(list)).not.toMatch(/Authorization|published/);
    expect(list[0]!.id).toBe(visible.id);
  });
});

describe("the database itself refuses an unauthorized publication", () => {
  it("rejects a published reference without authorization, even when the service is bypassed", async () => {
    await expect(db().reference.create({ data: { name: "Direct", sector: "x", description: "x", published: true, clientAuthorization: false } })).rejects.toThrow();
    const ok = await db().reference.create({ data: { name: "Direct 2", sector: "x", description: "x", published: false, clientAuthorization: false } });
    await expect(db().reference.update({ where: { id: ok.id }, data: { published: true } })).rejects.toThrow();
  });

  it("rejects a published testimonial without the written authorization", async () => {
    const r = await service().saveReference(ref({ clientAuthorization: true }), adminId);
    await expect(db().testimonial.create({ data: { quote: "q", author: "a", authorRole: "r", referenceId: r.id, published: true, writtenAuthorization: false } })).rejects.toThrow();
  });
});

describe("the logo", () => {
  it("is uploaded to the public references prefix, verified, and shown at its public address", async () => {
    const key = await uploadLogo();
    expect(key).toMatch(/^public\/references\/[\w-]+\.png$/);
    const saved = await service().saveReference(ref({ logoKey: key }), adminId);
    expect(saved.logoUrl).toBe(`https://files.example.com/bucket/${key}`);
  });

  it("accepts images only, and refuses a file whose content is not an image", async () => {
    expect(await failure(service().requestLogoUpload({ filename: "logo.pdf", mimeType: "application/pdf", sizeBytes: 100 }))).toMatchObject({ code: "TYPE_NOT_ALLOWED" });
    expect(await failure(service().requestLogoUpload({ filename: "logo.svg", mimeType: "image/svg+xml", sizeBytes: 100 }))).toMatchObject({ code: "TYPE_NOT_ALLOWED" });
    const key = await uploadLogo(FILES.exe); // named .png, but an executable inside
    expect(await failure(service().saveReference(ref({ logoKey: key }), adminId))).toMatchObject({ code: "INVALID_CONTENT" });
    expect(storage.deleted).toContain(key);
  });

  it("refuses a key outside the public references prefix (another client's file, a blog cover)", async () => {
    for (const key of ["clients/abc/secret.png", "public/blog/cover.png", "public/references/../x.png"]) {
      expect(await failure(service().saveReference(ref({ logoKey: key }), adminId))).toMatchObject({ code: "INVALID_KEY" });
    }
  });

  it("removes the old file when the logo is replaced or cleared, and keeps it when unchanged", async () => {
    const first = await uploadLogo();
    const saved = await service().saveReference(ref({ logoKey: first }), adminId);
    await service().saveReference(ref({ logoKey: first, sector: "Autre" }), adminId, saved.id);
    expect(storage.deleted).toEqual([]);
    const second = await uploadLogo();
    await service().saveReference(ref({ logoKey: second }), adminId, saved.id);
    expect(storage.deleted).toEqual([first]);
    await service().saveReference(ref({ logoKey: null }), adminId, saved.id);
    expect(storage.deleted).toEqual([first, second]);
    expect((await service().listReferences())[0]!.logoUrl).toBeUndefined();
  });
});

describe("the web address", () => {
  it("is optional and limited to http(s) links", () => {
    expect(ref({ url: "" }).url).toBeNull();
    expect(ref({ url: undefined }).url).toBeNull();
    expect(ref({ url: " https://exemple.ci " }).url).toBe("https://exemple.ci");
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://x.ci", "exemple.ci", "//x.ci"]) {
      expect(referenceInputSchema.safeParse({ name: "x", sector: "x", description: "x", published: false, clientAuthorization: false, url }).success, url).toBe(false);
    }
  });

  it("rejects empty required fields and out-of-range orders", () => {
    expect(referenceInputSchema.safeParse({ name: " ", sector: "x", description: "x", published: false, clientAuthorization: false }).success).toBe(false);
    expect(referenceInputSchema.safeParse({ name: "x", sector: "x", description: "x", published: false, clientAuthorization: false, displayOrder: -1 }).success).toBe(false);
  });
});

describe("testimonials", () => {
  async function authorizedReference(name = "Hôtel Exemple") {
    return service().saveReference(ref({ name, clientAuthorization: true, published: true }), adminId);
  }

  it("refuses to publish without the written authorization", async () => {
    const r = await authorizedReference();
    const error = await failure(service().saveTestimonial(quote(r.id, { published: true }), adminId));
    expect(error).toMatchObject({ code: "VALIDATION" });
    expect(error.message).toMatch(/autorisation écrite/);
  });

  it("refuses to publish when the named company did not authorize being named", async () => {
    const r = await service().saveReference(ref({ clientAuthorization: false }), adminId);
    const error = await failure(service().saveTestimonial(quote(r.id, { published: true, writtenAuthorization: true }), adminId));
    expect(error).toMatchObject({ code: "VALIDATION" });
    expect(error.message).toMatch(/Hôtel Exemple/);
  });

  it("publishes with both authorizations and shows the company, author and role", async () => {
    const r = await authorizedReference();
    await service().saveTestimonial(quote(r.id, { published: true, writtenAuthorization: true }), adminId);
    expect(await service().listPublicTestimonials()).toEqual([expect.objectContaining({ quote: "Un accompagnement précieux.", author: "A. Martin", authorRole: "Directrice", company: "Hôtel Exemple" })]);
    expect(revalidated.at(-1)).toEqual(REFERENCE_PATHS);
  });

  it("requires an existing reference", async () => {
    expect(await failure(service().saveTestimonial(quote("nope"), adminId))).toMatchObject({ code: "VALIDATION" });
  });

  it("hides the testimonial the moment the company withdraws its authorization or the reference is gone", async () => {
    const r = await authorizedReference();
    const t = await service().saveTestimonial(quote(r.id, { published: true, writtenAuthorization: true }), adminId);
    expect(await service().listPublicTestimonials()).toHaveLength(1);

    // The reference is withdrawn (unpublished and de-authorized): its testimonial must not stay online.
    await service().saveReference(ref({ clientAuthorization: false, published: false }), adminId, r.id);
    expect(await service().listPublicTestimonials()).toEqual([]);
    // It is still in the back-office, untouched.
    expect((await service().listTestimonials())[0]).toMatchObject({ id: t.id, published: true });
  });

  it("keeps testimonials that are unauthorized, drafts or deleted away from the public", async () => {
    const r = await authorizedReference();
    await service().saveTestimonial(quote(r.id, { author: "Brouillon" }), adminId);
    await service().saveTestimonial(quote(r.id, { author: "Non autorisé", writtenAuthorization: true }), adminId);
    const gone = await service().saveTestimonial(quote(r.id, { author: "Supprimé", published: true, writtenAuthorization: true }), adminId);
    await service().removeTestimonial(gone.id, adminId);
    expect(await service().listPublicTestimonials()).toEqual([]);
  });

  it("cannot delete a reference that still has testimonials", async () => {
    const r = await authorizedReference();
    const t = await service().saveTestimonial(quote(r.id), adminId);
    expect(await failure(service().removeReference(r.id, adminId))).toMatchObject({ code: "CONFLICT" });
    await service().removeTestimonial(t.id, adminId);
    await service().removeReference(r.id, adminId);
    expect(await service().listReferences()).toEqual([]);
  });

  it("validates its fields", () => {
    expect(testimonialInputSchema.safeParse({ quote: "", author: "a", authorRole: "r", referenceId: "x", published: false, writtenAuthorization: false }).success).toBe(false);
    expect(testimonialInputSchema.safeParse({ quote: "q", author: "a", authorRole: "r", referenceId: "x", published: false }).success).toBe(false);
  });
});

describe("FELKAT, the first reference", () => {
  it("exists as an unpublished, unauthorized draft, invisible to the public, with no logo", async () => {
    // Created by the migration in a fresh database; here, by the same idempotent seed, after the reset.
    expect(await seedStarterReference(db())).toBe(true);
    const felkat = (await service().listReferences()).find((r) => r.name === "FELKAT")!;
    expect(felkat).toMatchObject({ published: false, clientAuthorization: false, logoUrl: undefined });
    expect(await service().listPublicReferences()).toEqual([]);
  });

  it("is never recreated or overwritten once it exists, even after edits or a deletion", async () => {
    await seedStarterReference(db());
    const felkat = (await service().listReferences())[0]!;
    await service().saveReference(ref({ name: "FELKAT", sector: "Logistique", description: "Description réelle." }), adminId, felkat.id);
    expect(await seedStarterReference(db())).toBe(false);
    expect((await service().listReferences())[0]).toMatchObject({ sector: "Logistique", description: "Description réelle." });
    await service().removeReference(felkat.id, adminId);
    expect(await seedStarterReference(db())).toBe(false);
  });
});
