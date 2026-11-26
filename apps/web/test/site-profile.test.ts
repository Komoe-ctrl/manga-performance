import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedStarterReference, STARTER_DESCRIPTION, STARTER_SECTOR } from "@manga/db/references";
import { DEFAULT_KEY_FIGURES, defaultPublicPages } from "@/lib/content/public-profile";
import * as crm from "@/server/actions/crm";
import * as references from "@/server/actions/references";
import * as profile from "@/server/actions/site-profile";
import { DEFAULT_SETTINGS } from "@/server/repositories/settings";
import { actAs, createUser, db, login, resetDatabase, shutdown } from "./helpers";
import { MemoryStorage } from "./memory-storage";

const shared = vi.hoisted(() => ({ storage: undefined as unknown }));

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/queue", () => ({ getEnqueuer: async () => ({ enqueueEmail: async () => undefined, enqueueFanout: async () => undefined }) }));
vi.mock("@/server/storage/object-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage/object-storage")>()),
  getStorage: () => shared.storage,
}));

let adminId: string;
let adminEmail: string;

async function asAdmin() {
  const { cookie } = await login(adminEmail);
  await db().user.update({ where: { id: adminId }, data: { twoFactorEnabled: true } });
  actAs(cookie);
}

const settings = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_SETTINGS, ...over });

beforeEach(async () => {
  await resetDatabase();
  await db().$executeRawUnsafe(`TRUNCATE TABLE "Setting" CASCADE`);
  shared.storage = new MemoryStorage();
  actAs(null);
  const admin = await createUser({ role: "ADMIN" });
  adminId = admin.id;
  adminEmail = admin.email;
});
afterAll(shutdown);

describe("the public profile (recette B1 and B5)", () => {
  it("offers the defaults to a visitor before anything is configured: 10+ years, nothing legal, no case study, no FAQ", async () => {
    const result = await profile.getPublicProfileAction();
    expect(result).toMatchObject({ ok: true, data: { keyFigures: DEFAULT_KEY_FIGURES, legal: {} } });
    if (result.ok) for (const page of Object.values(result.data.services)) expect(page).toEqual({ caseStudy: undefined, faq: [] });
  });

  it("shows the key figures the consultant configured, and hides one that is emptied", async () => {
    await asAdmin();
    expect(await crm.saveSettingsAction(settings({ keyFigures: { experience: "12+", missions: "80+", sectors: "" } }))).toMatchObject({ ok: true });
    actAs(null);
    const result = await profile.getPublicProfileAction();
    expect(result).toMatchObject({ ok: true, data: { keyFigures: { experience: "12+", missions: "80+", sectors: undefined } } });
  });

  it("publishes legal information, a case study and an FAQ only once they are really provided", async () => {
    await asAdmin();
    const pages = defaultPublicPages();
    pages.legalForm = "[À fournir par le client]";
    pages.host = "Hébergeur Exemple";
    pages.services["maitrise-des-couts"] = { caseStudy: { client: "Client fictif", summary: "Un résumé." }, faq: [{ question: "Une question ?", answer: "Une réponse." }, { question: "", answer: "" }] };
    expect(await crm.saveSettingsAction(settings({ publicPages: pages }))).toMatchObject({ ok: true });

    actAs(null);
    const result = await profile.getPublicProfileAction();
    expect(result.ok && result.data.legal).toEqual({ host: "Hébergeur Exemple" });
    expect(result.ok && result.data.services["maitrise-des-couts"]).toEqual({ caseStudy: { client: "Client fictif", summary: "Un résumé." }, faq: [{ question: "Une question ?", answer: "Une réponse." }] });
    expect(JSON.stringify(result)).not.toMatch(/À fournir/);
  });

  it("never exposes the rest of the settings (VAT, bank details, WhatsApp, follow-ups) to a visitor", async () => {
    await asAdmin();
    await crm.saveSettingsAction(settings({ bankDetails: "IBAN SECRET 1234", vatPercent: 18, invoiceMentions: "Mention interne" }));
    actAs(null);
    const text = JSON.stringify(await profile.getPublicProfileAction());
    for (const secret of ["IBAN SECRET", "Mention interne", "bankDetails", "vatPercent", "whatsapp", "followUps", "invoiceMentions"]) expect(text).not.toContain(secret);
    // And the editor's read of the settings stays closed to a visitor.
    expect(await crm.getSettingsAction()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("refuses invalid configuration from the admin, and the old rows without the new fields still load", async () => {
    await asAdmin();
    expect(await crm.saveSettingsAction(settings({ keyFigures: { experience: "x".repeat(40), missions: "1", sectors: "1" } }))).toMatchObject({ ok: false, code: "INVALID" });
    expect(await crm.saveSettingsAction({ ...DEFAULT_SETTINGS, publicPages: undefined })).toMatchObject({ ok: false, code: "INVALID" });
    await db().setting.upsert({ where: { key: "cabinet" }, create: { key: "cabinet", value: { cabinetName: "Cabinet" } }, update: { value: { cabinetName: "Cabinet" } } });
    const loaded = await crm.getSettingsAction();
    expect(loaded).toMatchObject({ ok: true, data: { cabinetName: "Cabinet", keyFigures: DEFAULT_KEY_FIGURES } });
  });
});

describe("FELKAT, the first reference (recette B2)", () => {
  it("is a draft with the sector and description provided, no logo, no phone number, and invisible to the public", async () => {
    await seedStarterReference(db());
    const row = await db().reference.findFirstOrThrow({ where: { name: "FELKAT" } });
    expect(row).toMatchObject({ published: false, clientAuthorization: false, logoKey: null, url: null, sector: STARTER_SECTOR, description: STARTER_DESCRIPTION });
    expect(row.sector).toBe("Tech / SaaS — Intelligence artificielle conversationnelle");
    expect(row.description).toBe("FELKAT développe des agents vocaux IA qui automatisent les appels des entreprises : réponse aux clients, qualification des prospects et campagnes d'appels, avec une expérience naturelle et disponible 24 h/24.");
    expect(JSON.stringify([row.name, row.sector, row.description, row.url])).not.toMatch(/\+?\d[\d .-]{8,}/); // no phone number stored

    actAs(null);
    expect(await references.listPublicReferencesAction()).toEqual({ ok: true, data: [] });
  });

  it("cannot be published without the client's authorization", async () => {
    await seedStarterReference(db());
    await asAdmin();
    const felkat = await db().reference.findFirstOrThrow({ where: { name: "FELKAT" } });
    const input = { name: "FELKAT", sector: felkat.sector, description: felkat.description, published: true, clientAuthorization: false };
    expect(await references.saveReferenceAction(felkat.id, input)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await references.saveReferenceAction(felkat.id, { ...input, clientAuthorization: true })).toMatchObject({ ok: true });
  });
});
