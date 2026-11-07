import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/server/actions/scraper";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
vi.mock("@/server/queue", () => ({
  getEnqueuer: async () => ({ enqueueEmail: async () => undefined, enqueueFanout: async () => undefined }),
}));

const all: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
  ["createScrapeJob", () => actions.createScrapeJobAction({ source: "annuaire", filters: {} })],
  ["listScrapeJobs", () => actions.listScrapeJobsAction()],
  ["getScrapeJob", () => actions.getScrapeJobAction("x")],
  ["listScrapeResults", () => actions.listScrapeResultsAction("x")],
  ["importScrapeResults", () => actions.importScrapeResultsAction(["x"])],
];

let adminEmail: string;
let adminId: string;

beforeEach(async () => {
  await resetDatabase();
  actAs(null);
  const admin = await createUser({ role: "ADMIN" });
  adminEmail = admin.email;
  adminId = admin.id;
});
afterAll(shutdown);

describe("scraper actions are admin-only", () => {
  it.each(all)("%s refuses anonymous visitors", async (_n, run) => {
    expect(await run()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(all)("%s refuses a client", async (_n, run) => {
    const client = await createClientCompany("Acme");
    const user = await createUser({ role: "CLIENT", clientId: client.id });
    actAs((await login(user.email)).cookie);
    expect(await run()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it.each(all)("%s refuses an admin without 2FA", async (_n, run) => {
    actAs((await login(adminEmail)).cookie);
    expect(await run()).toMatchObject({ ok: false, code: "TWO_FACTOR_REQUIRED" });
  });
});

describe("as an admin with 2FA", () => {
  beforeEach(async () => {
    const { cookie } = await login(adminEmail);
    await db().user.update({ where: { id: adminId }, data: { twoFactorEnabled: true } });
    actAs(cookie);
  });

  it("creates, lists, reads and imports", async () => {
    const created = await actions.createScrapeJobAction({ source: "annuaire", filters: { city: "Abidjan" } });
    expect(created).toMatchObject({ ok: true, data: { source: "annuaire", status: "en_cours" } });
    if (!created.ok) throw new Error("setup failed");
    expect(await actions.listScrapeJobsAction()).toMatchObject({ ok: true, data: [{ id: created.data.id }] });
    expect(await actions.getScrapeJobAction(created.data.id)).toMatchObject({ ok: true, data: { id: created.data.id } });
    expect(await actions.listScrapeResultsAction(created.data.id)).toMatchObject({ ok: true, data: [] });
    expect(await actions.importScrapeResultsAction([])).toMatchObject({ ok: true, data: { imported: 0, skipped: 0 } });
  });

  it("answers invalid input with a result, not an exception", async () => {
    expect(await actions.createScrapeJobAction({ source: "linkedin", filters: {} })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.importScrapeResultsAction("not-an-array")).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.importScrapeResultsAction(Array.from({ length: 1001 }, (_, i) => `id${i}`))).toMatchObject({ ok: false, code: "INVALID" });
  });
});
