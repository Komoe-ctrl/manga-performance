import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/server/actions/crm";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});

const validProspect = {
  companyName: "Lagune Hôtel",
  sector: "Hôtellerie",
  source: "manuel",
};

/** Every CRM action, with arguments valid enough to get past input validation. */
const allActions: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
  ["listProspects", () => actions.listProspectsAction()],
  ["getProspect", () => actions.getProspectAction("x")],
  ["createProspect", () => actions.createProspectAction(validProspect)],
  ["updateProspectStatus", () => actions.updateProspectStatusAction({ id: "x", status: "perdu" })],
  ["listInteractions", () => actions.listInteractionsAction("x")],
  ["addInteraction", () => actions.addInteractionAction({ prospectId: "x", type: "note", summary: "s", date: "2026-11-06T10:00:00Z" })],
  ["listFollowUps", () => actions.listFollowUpsAction()],
  ["addFollowUp", () => actions.addFollowUpAction({ prospectId: "x", dueAt: "2026-11-06T10:00:00Z" })],
  ["completeFollowUp", () => actions.completeFollowUpAction("x")],
  ["listClients", () => actions.listClientsAction()],
  ["setClientAccess", () => actions.setClientAccessAction("x", true)],
  ["getSettings", () => actions.getSettingsAction()],
  ["saveSettings", () => actions.saveSettingsAction({})],
];

beforeEach(async () => {
  await resetDatabase();
  actAs(null);
});
afterAll(shutdown);

describe("CRM actions are admin-only", () => {
  it.each(allActions)("%s refuses anonymous visitors", async (_name, call) => {
    expect(await call()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(allActions)("%s refuses a client session", async (_name, call) => {
    const client = await createClientCompany("Acme");
    const user = await createUser({ role: "CLIENT", clientId: client.id });
    actAs((await login(user.email)).cookie);
    expect(await call()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it.each(allActions)("%s refuses an admin who has not enrolled 2FA", async (_name, call) => {
    const admin = await createUser({ role: "ADMIN" });
    actAs((await login(admin.email)).cookie);
    expect(await call()).toMatchObject({ ok: false, code: "TWO_FACTOR_REQUIRED" });
  });

  it("does not leak validation details to anonymous visitors", async () => {
    expect(await actions.createProspectAction({ nonsense: true })).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });
});

describe("CRM actions as an admin with 2FA", () => {
  async function actAsAdmin() {
    const admin = await createUser({ role: "ADMIN" });
    const { cookie } = await login(admin.email);
    await db().user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
    actAs(cookie);
    return admin;
  }

  it("creates and lists prospects", async () => {
    const admin = await actAsAdmin();
    const created = await actions.createProspectAction(validProspect);
    expect(created).toMatchObject({ ok: true, data: { companyName: "Lagune Hôtel", status: "nouveau" } });
    const list = await actions.listProspectsAction();
    expect(list.ok && list.data).toHaveLength(1);
    expect((await db().auditLog.findFirstOrThrow({ where: { action: "prospect.created" } })).actorId).toBe(admin.id);
  });

  it("rejects invalid input with a generic message", async () => {
    await actAsAdmin();
    expect(await actions.createProspectAction({ companyName: "", sector: "x" })).toMatchObject({
      ok: false,
      code: "INVALID",
    });
    expect(await actions.updateProspectStatusAction({ id: "x", status: "bogus" })).toMatchObject({
      ok: false,
      code: "INVALID",
    });
  });

  it("returns business errors as results, not exceptions", async () => {
    await actAsAdmin();
    await actions.createProspectAction(validProspect);
    const duplicate = await actions.createProspectAction(validProspect);
    expect(duplicate).toMatchObject({ ok: false, code: "DUPLICATE" });
    expect(await actions.updateProspectStatusAction({ id: "nope", status: "perdu" })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("runs the whole lifecycle through actions", async () => {
    await actAsAdmin();
    const created = await actions.createProspectAction({ ...validProspect, email: "awa@lagune.ci" });
    if (!created.ok) throw new Error("setup failed");
    const id = created.data.id;

    await actions.addInteractionAction({ prospectId: id, type: "appel", summary: "Appel", date: "2026-11-06T10:00:00Z" });
    expect((await actions.listInteractionsAction(id)).ok).toBe(true);
    const status = await actions.updateProspectStatusAction({ id, status: "client" });
    expect(status).toMatchObject({ ok: true, data: { status: "client" } });
    const clients = await actions.listClientsAction();
    expect(clients).toMatchObject({ ok: true, data: [{ id, accessActive: false }] });

    const settings = await actions.getSettingsAction();
    expect(settings.ok && settings.data.followUps).toEqual({ j7: true, j15: true, j30: false });
  });
});
