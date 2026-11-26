import { beforeEach, describe, expect, it, vi } from "vitest";

type Services = typeof import("@/lib/services/references");
let s: Services;

const draft = (over: Record<string, unknown> = {}) => ({ name: "Hôtel Démo", sector: "Hôtellerie", description: "Courte.", url: "", displayOrder: 0, published: false, clientAuthorization: false, logoKey: null, ...over });
const quote = (referenceId: string, over: Record<string, unknown> = {}) => ({ quote: "Très utile.", author: "A. Martin", authorRole: "DG", referenceId, published: false, writtenAuthorization: false, ...over });
const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as Error & { code?: string };
  }
  return null;
};

// The demo store lives in memory: each test starts from a fresh module.
beforeEach(async () => {
  vi.resetModules();
  s = await import("@/lib/services/references");
});

describe("demo references", () => {
  it("starts with FELKAT as an unpublished draft: the public site shows nothing", async () => {
    const all = await s.listReferences();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: "FELKAT", published: false, clientAuthorization: false });
    expect(all[0]!.logoUrl).toBeUndefined();
    expect(await s.listPublicReferences()).toEqual([]);
    expect(await s.listPublicTestimonials()).toEqual([]);
  });

  it("refuses to publish without the client's authorization, then publishes with it", async () => {
    expect(await refusal(() => s.saveReference(null, draft({ published: true })))).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/autorisation du client/) });
    await s.saveReference(null, draft({ published: true, clientAuthorization: true, displayOrder: 1 }));
    expect((await s.listPublicReferences()).map((r) => r.name)).toEqual(["Hôtel Démo"]);
    expect(Object.keys((await s.listPublicReferences())[0]!)).not.toContain("clientAuthorization");
  });

  it("applies the same testimonial rules, and hides it when the company withdraws", async () => {
    const r = await s.saveReference(null, draft({ clientAuthorization: true, published: true }));
    expect(await refusal(() => s.saveTestimonial(null, quote(r.id, { published: true })))).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/autorisation écrite/) });
    await s.saveTestimonial(null, quote(r.id, { published: true, writtenAuthorization: true }));
    expect(await s.listPublicTestimonials()).toEqual([expect.objectContaining({ company: "Hôtel Démo", author: "A. Martin" })]);

    await s.saveReference(r.id, draft({ clientAuthorization: false, published: false }));
    expect(await s.listPublicTestimonials()).toEqual([]);
    const unauthorized = await s.saveReference(null, draft({ name: "Sans accord" }));
    expect(await refusal(() => s.saveTestimonial(null, quote(unauthorized.id, { published: true, writtenAuthorization: true })))).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/Sans accord/) });
  });

  it("refuses duplicates and deleting a reference that still has testimonials", async () => {
    expect(await refusal(() => s.saveReference(null, draft({ name: "felkat" })))).toMatchObject({ code: "DUPLICATE" });
    const r = await s.saveReference(null, draft());
    const t = await s.saveTestimonial(null, quote(r.id));
    expect(await refusal(() => s.deleteReference(r.id))).toMatchObject({ code: "CONFLICT" });
    await s.deleteTestimonial(t.id);
    await s.deleteReference(r.id);
    expect((await s.listReferences()).map((x) => x.name)).toEqual(["FELKAT"]);
  });
});
