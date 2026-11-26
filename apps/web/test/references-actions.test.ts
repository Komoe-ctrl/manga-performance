import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/server/actions/references";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";
import { MemoryStorage } from "./memory-storage";

const shared = vi.hoisted(() => ({ storage: undefined as unknown, revalidated: [] as string[] }));

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void shared.revalidated.push(path) }));
vi.mock("@/server/storage/object-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage/object-storage")>()),
  getStorage: () => shared.storage,
}));

const reference = (over: Record<string, unknown> = {}) => ({ name: "Hôtel Exemple", sector: "Hôtellerie", description: "Courte description.", published: false, clientAuthorization: false, ...over });
const testimonial = (referenceId: string, over: Record<string, unknown> = {}) => ({ quote: "Très utile.", author: "A. Martin", authorRole: "DG", referenceId, published: false, writtenAuthorization: false, ...over });

const adminActions: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
  ["listReferences", () => actions.listReferencesAction()],
  ["saveReference", () => actions.saveReferenceAction(null, reference())],
  ["deleteReference", () => actions.deleteReferenceAction("x")],
  ["requestReferenceLogoUpload", () => actions.requestReferenceLogoUploadAction({ filename: "a.png", mimeType: "image/png", sizeBytes: 10 })],
  ["listTestimonials", () => actions.listTestimonialsAction()],
  ["saveTestimonial", () => actions.saveTestimonialAction(null, testimonial("x"))],
  ["deleteTestimonial", () => actions.deleteTestimonialAction("x")],
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
    const user = await createUser({ role: "CLIENT_DIRECTION", clientId: client.id });
    actAs((await login(user.email)).cookie);
    expect(await run()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it.each(adminActions)("%s refuses an admin without 2FA", async (_n, run) => {
    actAs((await login(adminEmail)).cookie);
    expect(await run()).toMatchObject({ ok: false, code: "TWO_FACTOR_REQUIRED" });
  });
});

describe("references and testimonials through actions", () => {
  it("answers an unauthorized publication with a readable refusal, and stores nothing", async () => {
    await asAdmin();
    expect(await actions.saveReferenceAction(null, reference({ published: true }))).toMatchObject({ ok: false, code: "VALIDATION", error: expect.stringMatching(/autorisation du client/) });
    expect(await db().reference.count()).toBe(0);
  });

  it("rejects invalid input, a dangerous link and an unknown id", async () => {
    await asAdmin();
    expect(await actions.saveReferenceAction(null, reference({ name: "" }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.saveReferenceAction(null, reference({ url: "javascript:alert(1)" }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.saveReferenceAction("nope", reference())).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.deleteTestimonialAction("nope")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("publishes a reference and a testimonial, which anonymous visitors then see, without any internal field", async () => {
    await asAdmin();
    const saved = await actions.saveReferenceAction(null, reference({ published: true, clientAuthorization: true, url: "https://exemple.ci" }));
    if (!saved.ok) throw new Error("setup failed");
    expect(await actions.saveTestimonialAction(null, testimonial(saved.data.id, { published: true, writtenAuthorization: true }))).toMatchObject({ ok: true });
    expect(shared.revalidated).toEqual(["/", "/references", "/", "/references"]);

    actAs(null); // a visitor, no session
    const references = await actions.listPublicReferencesAction();
    expect(references).toMatchObject({ ok: true, data: [{ name: "Hôtel Exemple", url: "https://exemple.ci" }] });
    expect(JSON.stringify(references)).not.toMatch(/Authorization|published/);
    expect(await actions.listPublicTestimonialsAction()).toMatchObject({ ok: true, data: [{ author: "A. Martin", company: "Hôtel Exemple" }] });
    // And a visitor cannot reach the back-office reads.
    expect(await actions.listReferencesAction()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("shows the public nothing, with no error, while nothing is published", async () => {
    await asAdmin();
    await actions.saveReferenceAction(null, reference());
    actAs(null);
    expect(await actions.listPublicReferencesAction()).toEqual({ ok: true, data: [] });
    expect(await actions.listPublicTestimonialsAction()).toEqual({ ok: true, data: [] });
  });

  it("issues logo uploads for PNG and JPG only, under the public references prefix", async () => {
    await asAdmin();
    expect(await actions.requestReferenceLogoUploadAction({ filename: "logo.jpg", mimeType: "image/jpeg", sizeBytes: 100 })).toMatchObject({ ok: true, data: { key: expect.stringMatching(/^public\/references\//) } });
    expect(await actions.requestReferenceLogoUploadAction({ filename: "logo.pdf", mimeType: "application/pdf", sizeBytes: 100 })).toMatchObject({ ok: false, code: "TYPE_NOT_ALLOWED" });
  });
});
