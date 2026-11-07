import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as downloadDeliverable } from "@/app/api/deliverables/[id]/download/route";
import { GET as downloadAttachment } from "@/app/api/messages/[id]/attachment/route";
import * as actions from "@/server/actions/client-space";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";
import { FILES, MemoryStorage } from "./memory-storage";

const shared = vi.hoisted(() => ({ storage: undefined as unknown }));

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/server/queue", () => ({
  getEnqueuer: async () => ({ enqueueEmail: async () => undefined, enqueueFanout: async () => undefined }),
}));
vi.mock("@/server/storage/object-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage/object-storage")>()),
  getStorage: () => shared.storage,
}));

let storage: MemoryStorage;

interface Space {
  clientId: string;
  prospectId: string;
  user: { id: string; email: string };
  cookie: string;
  deliverableId: string;
  messageId: string;
  attachmentKey: string;
}

let adminId: string;
let adminEmail: string;

async function space(name: string): Promise<Space> {
  const client = await createClientCompany(name);
  const user = await createUser({ role: "CLIENT", clientId: client.id });
  const prospectId = (await db().client.findUniqueOrThrow({ where: { id: client.id } })).prospectId;
  const key = `clients/${client.id}/deliverable-${name}.pdf`;
  storage.put(key, FILES.pdf);
  const deliverable = await db().deliverable.create({ data: { clientId: client.id, title: `Livrable ${name}`, storageKey: key, mimeType: "application/pdf", sizeBytes: 10, checksum: "x", publishedBy: adminId } });
  const attachmentKey = `clients/${client.id}/attachment-${name}.pdf`;
  storage.put(attachmentKey, FILES.pdf);
  const message = await db().message.create({ data: { clientId: client.id, authorId: user.id, fromRole: "CLIENT", body: `Message ${name}`, attachmentKey, attachmentName: `pj-${name}.pdf`, attachmentMime: "application/pdf", attachmentSize: 10 } });
  await db().notification.create({ data: { userId: user.id, type: "NEW_DELIVERABLE", payload: { deliverableId: deliverable.id, title: deliverable.title } } });
  return { clientId: client.id, prospectId, user, cookie: "", deliverableId: deliverable.id, messageId: message.id, attachmentKey };
}

const asClient = async (s: Space) => {
  s.cookie = (await login(s.user.email)).cookie;
  actAs(s.cookie);
};

async function asAdmin() {
  const { cookie } = await login(adminEmail);
  await db().user.update({ where: { id: adminId }, data: { twoFactorEnabled: true } });
  actAs(cookie);
}

const call = (route: typeof downloadDeliverable, id: string) => route(new Request(`https://app.example.com/api/x/${id}`), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDatabase();
  storage = new MemoryStorage();
  shared.storage = storage;
  actAs(null);
  const admin = await createUser({ role: "ADMIN" });
  adminId = admin.id;
  adminEmail = admin.email;
});
afterAll(shutdown);

const clientActions: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
  ["getMyCompany", () => actions.getMyCompanyAction()],
  ["listMyDeliverables", () => actions.listMyDeliverablesAction()],
  ["markDeliverableSeen", () => actions.markDeliverableSeenAction("x")],
  ["listMyMessages", () => actions.listMyMessagesAction()],
  ["requestMyAttachmentUpload", () => actions.requestMyAttachmentUploadAction({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 })],
  ["sendMyMessage", () => actions.sendMyMessageAction({ body: "Bonjour" })],
  ["markMyThreadRead", () => actions.markMyThreadReadAction()],
  ["listMyNotifications", () => actions.listMyNotificationsAction({})],
  ["listMyUnreadNotifications", () => actions.listMyUnreadNotificationsAction()],
  ["myUnreadNotificationCount", () => actions.myUnreadNotificationCountAction()],
  ["markNotificationRead", () => actions.markNotificationReadAction("x")],
  ["markAllNotificationsRead", () => actions.markAllNotificationsReadAction()],
];

const adminActions: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
  ["requestDeliverableUpload", () => actions.requestDeliverableUploadAction("x", { filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 })],
  ["publishDeliverable", () => actions.publishDeliverableAction({ clientId: "x", title: "T", key: "k" })],
  ["listClientDeliverables", () => actions.listClientDeliverablesAction("x")],
  ["listClientMessages", () => actions.listClientMessagesAction("x")],
  ["requestAdminAttachmentUpload", () => actions.requestAdminAttachmentUploadAction("x", { filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 })],
  ["sendAdminMessage", () => actions.sendAdminMessageAction({ clientId: "x", body: "Bonjour" })],
  ["markClientThreadRead", () => actions.markClientThreadReadAction("x")],
];

describe("access control", () => {
  it.each(clientActions)("client action %s refuses anonymous visitors", async (_n, run) => {
    expect(await run()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(clientActions)("client action %s refuses the admin", async (_n, run) => {
    await asAdmin();
    expect(await run()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it.each(adminActions)("admin action %s refuses anonymous visitors", async (_n, run) => {
    expect(await run()).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it.each(adminActions)("admin action %s refuses a client", async (_n, run) => {
    await asClient(await space("A"));
    expect(await run()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it.each(adminActions)("admin action %s refuses an admin without 2FA", async (_n, run) => {
    actAs((await login(adminEmail)).cookie);
    expect(await run()).toMatchObject({ ok: false, code: "TWO_FACTOR_REQUIRED" });
  });

  it("refuses a client whose access was disabled, and one whose company was deleted", async () => {
    const a = await space("A");
    await asClient(a);
    await db().user.update({ where: { id: a.user.id }, data: { disabledAt: new Date() } });
    expect(await actions.listMyDeliverablesAction()).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const b = await space("B");
    await asClient(b);
    await db().client.update({ where: { id: b.clientId }, data: { deletedAt: new Date() } });
    expect(await actions.listMyDeliverablesAction()).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("client A can never reach client B", () => {
  let a: Space;
  let b: Space;
  beforeEach(async () => {
    a = await space("A");
    b = await space("B");
    await asClient(a);
  });

  it("reads only its own company, deliverables, messages and notifications", async () => {
    expect(await actions.getMyCompanyAction()).toMatchObject({ ok: true, data: { companyName: "A", prospectId: a.prospectId } });
    const deliverables = await actions.listMyDeliverablesAction();
    expect(deliverables.ok && deliverables.data.map((d) => d.id)).toEqual([a.deliverableId]);
    const messages = await actions.listMyMessagesAction();
    expect(messages.ok && messages.data.map((m) => m.id)).toEqual([a.messageId]);
    const notifications = await actions.listMyNotificationsAction({});
    expect(notifications.ok && notifications.data.items).toHaveLength(1);
    expect(await actions.myUnreadNotificationCountAction()).toMatchObject({ ok: true, data: 1 });
  });

  it("cannot choose a client: a client id in the input is ignored", async () => {
    const sent = await actions.sendMyMessageAction({ body: "Pour B ?", clientId: b.clientId });
    expect(sent.ok).toBe(true);
    expect(await db().message.count({ where: { clientId: b.clientId } })).toBe(1); // only B's original
    expect(await db().message.count({ where: { clientId: a.clientId } })).toBe(2);
    expect((await db().message.findFirstOrThrow({ where: { body: "Pour B ?" } })).clientId).toBe(a.clientId);
  });

  it("uploads under its own prefix, and cannot attach a file of B", async () => {
    const ticket = await actions.requestMyAttachmentUploadAction({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 });
    expect(ticket.ok && ticket.data.key.startsWith(`clients/${a.clientId}/`)).toBe(true);

    const stolen = await actions.sendMyMessageAction({ body: "Voici", attachment: { key: b.attachmentKey, filename: "vol.pdf" } });
    expect(stolen).toMatchObject({ ok: false, code: "INVALID_KEY" });
    expect(storage.objects.has(b.attachmentKey)).toBe(true);
  });

  it("cannot mark B's notifications, deliverables or thread", async () => {
    const bNotification = await db().notification.findFirstOrThrow({ where: { userId: b.user.id } });
    expect(await actions.markNotificationReadAction(bNotification.id)).toMatchObject({ ok: true, data: { marked: false } });
    await actions.markDeliverableSeenAction(b.deliverableId);
    expect((await db().notification.findUniqueOrThrow({ where: { id: bNotification.id } })).readAt).toBeNull();
    // The thread it marks is its own, whatever it sends.
    await db().message.create({ data: { clientId: b.clientId, authorId: adminId, fromRole: "ADMIN", body: "Pour B" } });
    await actions.markMyThreadReadAction();
    expect((await db().message.findFirstOrThrow({ where: { body: "Pour B" } })).readAt).toBeNull();
  });

  it("downloads its own files, and gets 404 for B's, exactly like for a missing id", async () => {
    const own = await call(downloadDeliverable, a.deliverableId);
    expect(own.status).toBe(302);
    expect(own.headers.get("location")).toContain(`/download/clients/${a.clientId}/`);
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect(own.headers.get("referrer-policy")).toBe("no-referrer");

    const theirs = await call(downloadDeliverable, b.deliverableId);
    const missing = await call(downloadDeliverable, "does-not-exist");
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await missing.json());
    expect(theirs.headers.get("location")).toBeNull();

    expect((await call(downloadAttachment, a.messageId)).status).toBe(302);
    expect((await call(downloadAttachment, b.messageId)).status).toBe(404);
    expect(await db().deliverableDownload.count()).toBe(1);
  });
});

describe("download routes", () => {
  it("refuse anonymous visitors, and admins without 2FA", async () => {
    const a = await space("A");
    expect((await call(downloadDeliverable, a.deliverableId)).status).toBe(401);
    expect((await call(downloadAttachment, a.messageId)).status).toBe(401);
    actAs((await login(adminEmail)).cookie);
    expect((await call(downloadDeliverable, a.deliverableId)).status).toBe(403);
  });

  it("let the admin download any client's files, and log it", async () => {
    const a = await space("A");
    await asAdmin();
    expect((await call(downloadDeliverable, a.deliverableId)).status).toBe(302);
    expect((await call(downloadAttachment, a.messageId)).status).toBe(302);
    expect((await db().deliverableDownload.findFirstOrThrow()).userId).toBe(adminId);
  });
});

describe("back-office flows", () => {
  it("uploads, publishes and lists a deliverable for a client, by prospect id", async () => {
    const a = await space("A");
    await asAdmin();
    const ticket = await actions.requestDeliverableUploadAction(a.prospectId, { filename: "Budget.xlsx", mimeType: "", sizeBytes: FILES.xlsx.length });
    if (!ticket.ok) throw new Error("setup failed");
    expect(ticket.data.key.startsWith(`clients/${a.clientId}/`)).toBe(true);
    storage.put(ticket.data.key, FILES.xlsx);

    const published = await actions.publishDeliverableAction({ clientId: a.prospectId, title: "Budget 2027", key: ticket.data.key });
    expect(published).toMatchObject({ ok: true, data: { title: "Budget 2027", fileType: "xlsx", clientId: a.prospectId } });
    const list = await actions.listClientDeliverablesAction(a.prospectId);
    expect(list.ok && list.data.map((d) => d.title)).toEqual(expect.arrayContaining(["Budget 2027", "Livrable A"]));
  });

  it("refuses a prospect that is not a client, and invalid input", async () => {
    await asAdmin();
    const prospect = await db().prospect.create({ data: { companyName: "Prospect", companyNameNorm: "prospect", sector: "x", source: "MANUEL" } });
    expect(await actions.listClientMessagesAction(prospect.id)).toMatchObject({ ok: false, code: "CLIENT_NOT_FOUND" });
    expect(await actions.sendAdminMessageAction({ clientId: "x" })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await actions.requestDeliverableUploadAction("x", { filename: "", mimeType: "", sizeBytes: 0 })).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("lets the consultant answer and read the thread, which marks the client's messages as read", async () => {
    const a = await space("A");
    await asAdmin();
    expect(await actions.sendAdminMessageAction({ clientId: a.prospectId, body: "Bien reçu." })).toMatchObject({ ok: true, data: { from: "consultant" } });
    const thread = await actions.listClientMessagesAction(a.prospectId);
    expect(thread.ok && thread.data.map((m) => m.from)).toEqual(["client", "consultant"]);
    expect(await actions.markClientThreadReadAction(a.prospectId)).toMatchObject({ ok: true, data: { marked: 1 } });
  });

  it("gives the client what the existing screens expect for notifications", async () => {
    const a = await space("A");
    await asClient(a);
    const unread = await actions.listMyUnreadNotificationsAction();
    expect(unread).toMatchObject({ ok: true, data: [{ kind: "livrable", title: "Nouveau livrable : Livrable A", href: "/espace-client" }] });
    await actions.markAllNotificationsReadAction();
    expect(await actions.listMyUnreadNotificationsAction()).toMatchObject({ ok: true, data: [] });
  });
});
