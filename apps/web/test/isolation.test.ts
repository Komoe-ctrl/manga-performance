import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requireClient } from "@/server/auth/guards";
import {
  getDeliverable,
  getInvoice,
  listDeliverables,
  listInvoices,
  listMessages,
  listNotifications,
} from "@/server/repositories/client-space";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});

async function seedClient(name: string) {
  const client = await createClientCompany(name);
  const user = await createUser({ role: "CLIENT", clientId: client.id });
  const invoice = await db().invoice.create({
    data: { clientId: client.id, status: "EMISE", number: `2026-${name}`, totalHt: 100, totalVat: 18, totalTtc: 118 },
  });
  const draft = await db().invoice.create({
    data: { clientId: client.id, status: "BROUILLON", totalHt: 1, totalVat: 0, totalTtc: 1 },
  });
  const deliverable = await db().deliverable.create({
    data: {
      clientId: client.id,
      title: `Livrable ${name}`,
      storageKey: `clients/${client.id}/file.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 10,
      checksum: "abc",
      publishedBy: "admin",
    },
  });
  const message = await db().message.create({
    data: { clientId: client.id, authorId: user.id, fromRole: "CLIENT", body: `Message ${name}` },
  });
  const notification = await db().notification.create({
    data: { userId: user.id, type: "NEW_MESSAGE", payload: {} },
  });
  actAs((await login(user.email)).cookie);
  const session = await requireClient();
  return { client, user, session, invoice, draft, deliverable, message, notification };
}

let a: Awaited<ReturnType<typeof seedClient>>;
let b: Awaited<ReturnType<typeof seedClient>>;

beforeEach(async () => {
  await resetDatabase();
  a = await seedClient("A");
  b = await seedClient("B");
});
afterAll(shutdown);

describe("client A cannot read client B's data", () => {
  it("lists only its own resources", async () => {
    expect((await listInvoices(a.session)).map((i) => i.id)).toEqual([a.invoice.id]);
    expect((await listDeliverables(a.session)).map((d) => d.id)).toEqual([a.deliverable.id]);
    expect((await listMessages(a.session)).map((m) => m.id)).toEqual([a.message.id]);
    expect((await listNotifications(a.session)).map((n) => n.id)).toEqual([a.notification.id]);
  });

  it("cannot fetch B's resources by direct id", async () => {
    expect(await getInvoice(a.session, b.invoice.id)).toBeNull();
    expect(await getDeliverable(a.session, b.deliverable.id)).toBeNull();
  });

  it("can fetch its own resources by id", async () => {
    expect((await getInvoice(a.session, a.invoice.id))?.id).toBe(a.invoice.id);
    expect((await getDeliverable(a.session, a.deliverable.id))?.id).toBe(a.deliverable.id);
  });

  it("never exposes draft invoices, not even its own", async () => {
    expect(await getInvoice(a.session, a.draft.id)).toBeNull();
    expect((await listInvoices(a.session)).some((i) => i.id === a.draft.id)).toBe(false);
  });
});
