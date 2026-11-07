import { createHash } from "node:crypto";
import type { EmailJob } from "@manga/emails";
import type { FanoutJob } from "@manga/emails/jobs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClientSpaceService, ClientSpaceError, type Viewer } from "@/server/client-space/client-space-service";
import { FileError } from "@/server/files/upload-service";
import { createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";
import { FILES, MemoryStorage } from "./memory-storage";

let storage: MemoryStorage;
let fanouts: { job: FanoutJob; dedupeKey?: string }[];
let emails: EmailJob[];
let clock: Date;

const service = () =>
  createClientSpaceService({
    prisma: db(),
    storage,
    queue: {
      enqueueEmail: async (job) => void emails.push(job),
      enqueueFanout: async (job, options) => void fanouts.push({ job, dedupeKey: options?.dedupeKey }),
    },
    appUrl: "https://app.example.com",
    adminEmail: "admin@example.com",
    now: () => clock,
  });

interface World {
  clientId: string;
  prospectId: string;
  user: { id: string; email: string };
  viewer: Viewer;
}

async function world(name: string): Promise<World> {
  const client = await createClientCompany(name);
  const user = await createUser({ role: "CLIENT", clientId: client.id });
  const row = await db().client.findUniqueOrThrow({ where: { id: client.id } });
  return { clientId: client.id, prospectId: row.prospectId, user, viewer: { userId: user.id, role: "CLIENT", clientId: client.id } };
}

let adminId: string;
const adminViewer = (): Viewer => ({ userId: adminId, role: "ADMIN", clientId: null });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FileError || error instanceof ClientSpaceError) return error;
    throw error;
  }
  throw new Error("expected an error");
};

/** Simulates the browser's upload, then publishes. */
async function publish(w: World, title = "Bilan T3", file = FILES.pdf, filename = "bilan.pdf") {
  const ticket = await service().requestDeliverableUpload(w.clientId, { filename, mimeType: "", sizeBytes: file.length });
  storage.put(ticket.key, file);
  return service().publishDeliverable({ clientId: w.clientId, title, key: ticket.key }, adminId);
}

beforeEach(async () => {
  await resetDatabase();
  storage = new MemoryStorage();
  fanouts = [];
  emails = [];
  clock = new Date("2026-11-07T09:00:00Z");
  adminId = (await createUser({ role: "ADMIN" })).id;
});
afterAll(shutdown);

describe("upload requests", () => {
  it("returns a presigned PUT bound to the exact size and type, under the client's prefix", async () => {
    const w = await world("Acme");
    const ticket = await service().requestDeliverableUpload(w.clientId, { filename: "Bilan 2026.PDF", mimeType: "application/pdf", sizeBytes: 12_345 });
    expect(ticket.key).toMatch(new RegExp(`^clients/${w.clientId}/[A-Za-z0-9_-]{24}\\.pdf$`));
    expect(ticket).toMatchObject({ headers: { "Content-Type": "application/pdf" }, expiresInSeconds: 600, maxBytes: 25 * 1024 * 1024 });
    expect(storage.uploads).toEqual([{ key: ticket.key, contentType: "application/pdf", contentLength: 12_345, expiresInSeconds: 600 }]);
  });

  it.each([
    [{ filename: "virus.exe", mimeType: "application/pdf", sizeBytes: 10 }, "TYPE_NOT_ALLOWED"],
    [{ filename: "page.html", mimeType: "text/html", sizeBytes: 10 }, "TYPE_NOT_ALLOWED"],
    [{ filename: "a.pdf", mimeType: "image/png", sizeBytes: 10 }, "TYPE_MISMATCH"],
    [{ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 26 * 1024 * 1024 }, "TOO_LARGE"],
    [{ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 0 }, "EMPTY"],
  ])("refuses %j", async (input, code) => {
    const w = await world("Acme");
    expect((await failure(service().requestDeliverableUpload(w.clientId, input))).code).toBe(code);
    expect(storage.uploads).toHaveLength(0);
  });

  it("gives every upload its own unguessable key", async () => {
    const w = await world("Acme");
    const input = { filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 };
    const keys = await Promise.all(Array.from({ length: 5 }, () => service().requestAttachmentUpload(w.clientId, input).then((t) => t.key)));
    expect(new Set(keys).size).toBe(5);
  });
});

describe("publishing a deliverable", () => {
  it("verifies the file, records it with its SHA-256, audits it, and returns the front's shape", async () => {
    const w = await world("Acme");
    const deliverable = await publish(w);
    const row = await db().deliverable.findUniqueOrThrow({ where: { id: deliverable.id } });

    expect(row).toMatchObject({ clientId: w.clientId, title: "Bilan T3", mimeType: "application/pdf", sizeBytes: FILES.pdf.length, publishedBy: adminId });
    expect(row.checksum).toBe(createHash("sha256").update(Buffer.from(FILES.pdf, "latin1")).digest("hex"));
    expect(row.storageKey).toMatch(new RegExp(`^clients/${w.clientId}/`));
    expect(deliverable).toMatchObject({ clientId: w.prospectId, title: "Bilan T3", fileType: "pdf", sizeKb: 1, isNew: true });
    expect(await db().auditLog.count({ where: { entityId: deliverable.id, action: "deliverable.published" } })).toBe(1);
  });

  it("accepts every supported kind, detected from the content", async () => {
    const w = await world("Acme");
    for (const [kind, file, name] of [["xlsx", FILES.xlsx, "t.xlsx"], ["docx", FILES.docx, "n.docx"], ["png", FILES.png, "l.png"], ["jpg", FILES.jpg, "p.jpeg"]] as const) {
      expect((await publish(w, kind, file, name)).fileType).toBe(kind);
    }
  });

  it("notifies each active portal user in the app and by email, never twice", async () => {
    const w = await world("Acme");
    const second = await createUser({ role: "CLIENT", clientId: w.clientId });
    const disabled = await createUser({ role: "CLIENT", clientId: w.clientId });
    await db().user.update({ where: { id: disabled.id }, data: { disabledAt: new Date() } });
    const other = await world("Autre");

    const deliverable = await publish(w);
    expect(fanouts.map((f) => f.job.audience)).toEqual(expect.arrayContaining([{ userId: w.user.id }, { userId: second.id }]));
    expect(fanouts).toHaveLength(2);
    for (const { job, dedupeKey } of fanouts) {
      expect(job).toMatchObject({ type: "NEW_DELIVERABLE", payload: { deliverableId: deliverable.id, title: "Bilan T3" }, email: { template: "new-deliverable", data: { title: "Bilan T3", url: "https://app.example.com/espace-client" } } });
      expect(dedupeKey).toMatch(new RegExp(`^deliverable:${deliverable.id}:`));
    }
    expect(JSON.stringify(fanouts)).not.toContain(other.user.id);
  });

  it("refuses a file whose content is not what its name says, and deletes it", async () => {
    const w = await world("Acme");
    const ticket = await service().requestDeliverableUpload(w.clientId, { filename: "rapport.pdf", mimeType: "application/pdf", sizeBytes: 50 });
    storage.put(ticket.key, FILES.exe);
    const error = await failure(service().publishDeliverable({ clientId: w.clientId, title: "Rapport", key: ticket.key }, adminId));
    expect(error.code).toBe("INVALID_CONTENT");
    expect(storage.deleted).toEqual([ticket.key]);
    expect(await db().deliverable.count()).toBe(0);
    expect(fanouts).toHaveLength(0);
  });

  it("refuses a Word file uploaded as .xlsx", async () => {
    const w = await world("Acme");
    expect((await failure(publish(w, "Faux", FILES.docx, "faux.xlsx"))).code).toBe("INVALID_CONTENT");
  });

  it("refuses an upload that never arrived, an oversized one, and an empty one", async () => {
    const w = await world("Acme");
    const ticket = await service().requestDeliverableUpload(w.clientId, { filename: "a.pdf", mimeType: "", sizeBytes: 10 });
    expect((await failure(service().publishDeliverable({ clientId: w.clientId, title: "x", key: ticket.key }, adminId))).code).toBe("FILE_MISSING");

    storage.put(ticket.key, new Uint8Array(25 * 1024 * 1024 + 1));
    expect((await failure(service().publishDeliverable({ clientId: w.clientId, title: "x", key: ticket.key }, adminId))).code).toBe("TOO_LARGE");
    storage.put(ticket.key, new Uint8Array());
    expect((await failure(service().publishDeliverable({ clientId: w.clientId, title: "x", key: ticket.key }, adminId))).code).toBe("EMPTY");
  });

  it("refuses a key that belongs to another client, without touching the file", async () => {
    const a = await world("A");
    const b = await world("B");
    const ticket = await service().requestDeliverableUpload(b.clientId, { filename: "secret.pdf", mimeType: "", sizeBytes: 10 });
    storage.put(ticket.key, FILES.pdf);
    expect((await failure(service().publishDeliverable({ clientId: a.clientId, title: "Vol", key: ticket.key }, adminId))).code).toBe("INVALID_KEY");
    expect(storage.objects.has(ticket.key)).toBe(true);
    for (const key of ["clients/../etc/passwd.pdf", "public/blog/cover.png", `clients/${a.clientId}/sub/x.pdf`, ""]) {
      expect((await failure(service().publishDeliverable({ clientId: a.clientId, title: "x", key }, adminId))).code).toBe("INVALID_KEY");
    }
  });

  it("validates the title and the client", async () => {
    const w = await world("Acme");
    const ticket = await service().requestDeliverableUpload(w.clientId, { filename: "a.pdf", mimeType: "", sizeBytes: 10 });
    storage.put(ticket.key, FILES.pdf);
    expect((await failure(service().publishDeliverable({ clientId: w.clientId, title: "  ", key: ticket.key }, adminId))).code).toBe("INVALID");
    expect((await failure(service().publishDeliverable({ clientId: w.clientId, title: "x".repeat(201), key: ticket.key }, adminId))).code).toBe("INVALID");
    expect((await failure(service().publishDeliverable({ clientId: "nope", title: "x", key: ticket.key }, adminId))).code).toBe("CLIENT_NOT_FOUND");
  });
});

describe("listing, seen and download", () => {
  it("shows a deliverable as new until the client has seen it, and only to its own client", async () => {
    const a = await world("A");
    const b = await world("B");
    const deliverable = await publish(a);
    // The worker would create these notifications from the fan-out jobs.
    await db().notification.create({ data: { userId: a.user.id, type: "NEW_DELIVERABLE", payload: { deliverableId: deliverable.id, title: "Bilan T3" } } });

    expect((await service().listDeliverables(a.clientId, a.viewer)).map((d) => [d.id, d.isNew])).toEqual([[deliverable.id, true]]);
    expect(await service().listDeliverables(b.clientId, b.viewer)).toEqual([]);
    expect((await service().listDeliverables(a.clientId, adminViewer()))[0]!.isNew).toBe(false);

    await service().markDeliverableSeen(a.viewer, deliverable.id);
    expect((await service().listDeliverables(a.clientId, a.viewer))[0]!.isNew).toBe(false);
    expect(await service().unreadNotificationCount(a.user.id)).toBe(0);
  });

  it("does not let another client mark it seen", async () => {
    const a = await world("A");
    const b = await world("B");
    const deliverable = await publish(a);
    await db().notification.create({ data: { userId: a.user.id, type: "NEW_DELIVERABLE", payload: { deliverableId: deliverable.id } } });
    await service().markDeliverableSeen(b.viewer, deliverable.id);
    expect(await service().unreadNotificationCount(a.user.id)).toBe(1);
  });

  it("gives a 5-minute forced download and logs who downloaded", async () => {
    const a = await world("A");
    const deliverable = await publish(a, "Bilan été 2026");
    const link = await service().deliverableDownload(a.viewer, deliverable.id);
    expect(link.expiresInSeconds).toBe(300);
    expect(link.url).toContain("signed=1");
    expect(storage.downloads).toMatchObject([{ filename: "Bilan été 2026.pdf" }]);

    await service().deliverableDownload(adminViewer(), deliverable.id);
    const logs = await db().deliverableDownload.findMany({ where: { deliverableId: deliverable.id }, orderBy: { downloadedAt: "asc" } });
    expect(logs.map((l) => l.userId).sort()).toEqual([a.user.id, adminId].sort());
  });

  it("answers NOT_FOUND to another client, and logs nothing", async () => {
    const a = await world("A");
    const b = await world("B");
    const deliverable = await publish(a);
    expect((await failure(service().deliverableDownload(b.viewer, deliverable.id))).code).toBe("NOT_FOUND");
    expect((await failure(service().deliverableDownload(b.viewer, "does-not-exist"))).code).toBe("NOT_FOUND");
    expect(await db().deliverableDownload.count()).toBe(0);
    expect(storage.downloads).toHaveLength(0);
  });

  it("refuses a client viewer that has no client attached", async () => {
    const a = await world("A");
    const deliverable = await publish(a);
    const orphan: Viewer = { userId: "u", role: "CLIENT", clientId: null };
    expect((await failure(service().deliverableDownload(orphan, deliverable.id))).code).toBe("NOT_FOUND");
  });
});

describe("messages", () => {
  it("lets the client write, and alerts the consultant without sending the message", async () => {
    const w = await world("Lagune Hôtel");
    const message = await service().sendMessage({ clientId: w.clientId, fromRole: "CLIENT", authorId: w.user.id, body: "  Bonjour, voici mes chiffres confidentiels.  " });
    expect(message).toMatchObject({ clientId: w.prospectId, from: "client", body: "Bonjour, voici mes chiffres confidentiels.", read: false });

    expect(fanouts).toHaveLength(1);
    expect(fanouts[0]).toMatchObject({
      dedupeKey: `message:${message.id}`,
      job: { type: "NEW_MESSAGE", audience: "ADMINS", payload: { clientId: w.clientId, messageId: message.id }, email: { template: "new-message", to: "admin@example.com", data: { name: "Lagune Hôtel", url: "https://app.example.com/admin/clients" } } },
    });
    expect(JSON.stringify(fanouts)).not.toContain("chiffres confidentiels");
  });

  it("lets the consultant answer, alerting each active portal user", async () => {
    const w = await world("Acme");
    const second = await createUser({ role: "CLIENT", clientId: w.clientId });
    const message = await service().sendMessage({ clientId: w.clientId, fromRole: "ADMIN", authorId: adminId, body: "Merci, je regarde." });
    expect(message.from).toBe("consultant");
    expect(fanouts.map((f) => f.job.audience)).toEqual(expect.arrayContaining([{ userId: w.user.id }, { userId: second.id }]));
    expect(JSON.stringify(fanouts)).not.toContain("je regarde");
    expect(fanouts[0]!.job.email).toMatchObject({ template: "new-message", data: { url: "https://app.example.com/espace-client/messages" } });
  });

  it("validates the body", async () => {
    const w = await world("Acme");
    for (const body of ["", "   ", "x".repeat(5001)]) {
      expect((await failure(service().sendMessage({ clientId: w.clientId, fromRole: "CLIENT", authorId: w.user.id, body }))).code).toBe("INVALID");
    }
    expect(await db().message.count()).toBe(0);
  });

  it("keeps the thread in order, with the read state and the attachment name", async () => {
    const w = await world("Acme");
    await service().sendMessage({ clientId: w.clientId, fromRole: "CLIENT", authorId: w.user.id, body: "Un" });
    clock = new Date(clock.getTime() + 60_000);
    await service().sendMessage({ clientId: w.clientId, fromRole: "ADMIN", authorId: adminId, body: "Deux" });
    const thread = await service().listMessages(w.clientId);
    expect(thread.map((m) => [m.from, m.body, m.read, m.attachment])).toEqual([["client", "Un", false, undefined], ["consultant", "Deux", false, undefined]]);
  });

  it("verifies and stores an attachment, and serves it only to the thread's client or the admin", async () => {
    const a = await world("A");
    const b = await world("B");
    const ticket = await service().requestAttachmentUpload(a.clientId, { filename: "../../Relevé banque.pdf", mimeType: "application/pdf", sizeBytes: FILES.pdf.length });
    storage.put(ticket.key, FILES.pdf);
    const message = await service().sendMessage({ clientId: a.clientId, fromRole: "CLIENT", authorId: a.user.id, body: "Voir pièce jointe", attachment: { key: ticket.key, filename: "../../Relevé banque.pdf" } });
    expect(message.attachment).toBe("Relevé banque.pdf");
    expect(await db().message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ attachmentKey: ticket.key, attachmentName: "Relevé banque.pdf", attachmentMime: "application/pdf", attachmentSize: FILES.pdf.length });

    expect((await service().attachmentDownload(a.viewer, message.id)).expiresInSeconds).toBe(300);
    expect(storage.downloads.at(-1)).toMatchObject({ key: ticket.key, filename: "Relevé banque.pdf" });
    await service().attachmentDownload(adminViewer(), message.id);
    expect(await db().auditLog.count({ where: { entityId: message.id, action: "message.attachment.downloaded" } })).toBe(2);

    expect((await failure(service().attachmentDownload(b.viewer, message.id))).code).toBe("NOT_FOUND");
    expect(await db().auditLog.count({ where: { entityId: message.id, action: "message.attachment.downloaded" } })).toBe(2);
  });

  it("rejects an attachment with the wrong content, another client's key, and a message without attachment", async () => {
    const a = await world("A");
    const b = await world("B");
    const bad = await service().requestAttachmentUpload(a.clientId, { filename: "x.pdf", mimeType: "", sizeBytes: 10 });
    storage.put(bad.key, FILES.exe);
    expect((await failure(service().sendMessage({ clientId: a.clientId, fromRole: "CLIENT", authorId: a.user.id, body: "x", attachment: { key: bad.key, filename: "x.pdf" } }))).code).toBe("INVALID_CONTENT");

    const theirs = await service().requestAttachmentUpload(b.clientId, { filename: "x.pdf", mimeType: "", sizeBytes: 10 });
    storage.put(theirs.key, FILES.pdf);
    expect((await failure(service().sendMessage({ clientId: a.clientId, fromRole: "CLIENT", authorId: a.user.id, body: "x", attachment: { key: theirs.key, filename: "x.pdf" } }))).code).toBe("INVALID_KEY");
    expect(await db().message.count()).toBe(0);

    const plain = await service().sendMessage({ clientId: a.clientId, fromRole: "CLIENT", authorId: a.user.id, body: "sans pièce jointe" });
    expect((await failure(service().attachmentDownload(a.viewer, plain.id))).code).toBe("NOT_FOUND");
  });

  it("marks only the other side's messages as read when a thread is opened", async () => {
    const w = await world("Acme");
    const mine = await service().sendMessage({ clientId: w.clientId, fromRole: "CLIENT", authorId: w.user.id, body: "Du client" });
    const theirs = await service().sendMessage({ clientId: w.clientId, fromRole: "ADMIN", authorId: adminId, body: "Du consultant" });
    await db().notification.create({ data: { userId: w.user.id, type: "NEW_MESSAGE", payload: { clientId: w.clientId, messageId: theirs.id } } });

    expect(await service().markThreadRead(w.viewer, w.clientId)).toEqual({ marked: 1 });
    const state = Object.fromEntries((await service().listMessages(w.clientId)).map((m) => [m.id, m.read]));
    expect(state).toEqual({ [mine.id]: false, [theirs.id]: true });
    expect(await service().unreadNotificationCount(w.user.id)).toBe(0);

    expect(await service().markThreadRead(adminViewer(), w.clientId)).toEqual({ marked: 1 });
    expect((await service().listMessages(w.clientId)).every((m) => m.read)).toBe(true);
    expect(await service().markThreadRead(adminViewer(), w.clientId)).toEqual({ marked: 0 });
  });

  it("does not mark another client's thread through your own session", async () => {
    const a = await world("A");
    const b = await world("B");
    await service().sendMessage({ clientId: a.clientId, fromRole: "ADMIN", authorId: adminId, body: "Pour A" });
    // The scope is the clientId the caller (the action) takes from the session.
    expect(await service().markThreadRead(b.viewer, b.clientId)).toEqual({ marked: 0 });
    expect((await service().listMessages(a.clientId))[0]!.read).toBe(false);
  });
});

describe("notifications", () => {
  async function seed(userId: string, count: number, type = "NEW_MESSAGE") {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const row = await db().notification.create({ data: { userId, type, payload: { title: `N${i}`, clientId: "c" }, createdAt: new Date(clock.getTime() + i * 1000) } });
      ids.push(row.id);
    }
    return ids;
  }

  it("pages through the user's notifications, newest first, with a cursor", async () => {
    const w = await world("A");
    const ids = await seed(w.user.id, 5);
    const first = await service().listNotifications(w.user.id, { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual([ids[4], ids[3]]);
    expect(first.nextCursor).toBe(ids[3]);
    const second = await service().listNotifications(w.user.id, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
    const last = await service().listNotifications(w.user.id, { limit: 2, cursor: second.nextCursor! });
    expect(last.items.map((i) => i.id)).toEqual([ids[0]]);
    expect(last.nextCursor).toBeNull();
  });

  it("describes known types in French and keeps the unread filter and counter", async () => {
    const w = await world("A");
    await db().notification.create({ data: { userId: w.user.id, type: "NEW_DELIVERABLE", payload: { deliverableId: "d", title: "Bilan" } } });
    const [message] = await seed(w.user.id, 1);
    await db().notification.update({ where: { id: message! }, data: { readAt: new Date() } });

    const all = await service().listNotifications(w.user.id);
    expect(all.items.find((i) => i.kind === "livrable")).toMatchObject({ title: "Nouveau livrable : Bilan", href: "/espace-client", read: false });
    expect(all.items.find((i) => i.kind === "message")).toMatchObject({ title: "Nouveau message du consultant", href: "/espace-client/messages", read: true });
    expect((await service().listNotifications(w.user.id, { unreadOnly: true })).items).toHaveLength(1);
    expect(await service().unreadNotificationCount(w.user.id)).toBe(1);
  });

  it("clamps the page size", async () => {
    const w = await world("A");
    await seed(w.user.id, 3);
    expect((await service().listNotifications(w.user.id, { limit: 0 })).items).toHaveLength(1);
    expect((await service().listNotifications(w.user.id, { limit: 1000 })).items).toHaveLength(3);
  });

  it("marks one or all as read, for the owner only", async () => {
    const a = await world("A");
    const b = await world("B");
    const [first] = await seed(a.user.id, 3);
    await seed(b.user.id, 2);

    expect(await service().markNotificationRead(b.user.id, first!)).toBe(false); // someone else's
    expect(await service().unreadNotificationCount(a.user.id)).toBe(3);
    expect(await service().markNotificationRead(a.user.id, first!)).toBe(true);
    expect(await service().markNotificationRead(a.user.id, first!)).toBe(false); // already read
    expect(await service().markAllNotificationsRead(a.user.id)).toBe(2);
    expect(await service().unreadNotificationCount(a.user.id)).toBe(0);
    expect(await service().unreadNotificationCount(b.user.id)).toBe(2);
  });

  it("never exposes another user's notifications, even by cursor", async () => {
    const a = await world("A");
    const b = await world("B");
    const [secret] = await seed(b.user.id, 1);
    await seed(a.user.id, 1);
    const page = await service().listNotifications(a.user.id, { cursor: secret });
    expect(page.items.every((i) => i.id !== secret)).toBe(true);
  });
});
