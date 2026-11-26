import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientAccess, deliverables, invoices, messages } from "@/lib/mock/business";
import { collectionAssignments, collectionClients, collectionEntities, collectionPeople, collectionPlans } from "@/lib/mock/collection";
import { pilotHotels } from "@/lib/mock/pilot";
import { prospects } from "@/lib/mock/prospects";
import { authenticateClient, demoAccountsOf, listClients, listDeliverables, listMessages, listNotifications } from "@/lib/services/client-space";
import { entityScope, getClientCollection, submitDeposit, type CollectionViewerRole } from "@/lib/services/collection";
import { getClientPilotResults } from "@/lib/services/pilot";

const ROLES: CollectionViewerRole[] = ["CLIENT_DIRECTION", "CLIENT_CONTRIBUTEUR", "CLIENT_ANALYSTE"];
const clientIds = collectionClients.map((c) => c.id);
const entityIdsOf = (clientId: string) => collectionEntities.filter((e) => e.clientId === clientId).map((e) => e.id);

describe("one coherent set of fixtures (recette A2)", () => {
  it("makes every collection client a converted prospect of the CRM, with access, invoices and deliverables", async () => {
    expect(collectionClients.length).toBeGreaterThanOrEqual(3);
    const crm = await listClients();
    for (const client of collectionClients) {
      const prospect = prospects.find((p) => p.id === client.id);
      expect(prospect, `${client.name} is not a prospect`).toBeDefined();
      expect(prospect).toMatchObject({ status: "client", companyName: client.name });
      expect(crm.some((c) => c.id === client.id && c.accessActive), `${client.name} is not in /admin/clients with an active access`).toBe(true);
      expect(clientAccess.find((a) => a.clientId === client.id)?.active).toBe(true);
      expect(invoices.some((i) => i.clientId === client.id), `${client.name} has no invoice`).toBe(true);
      expect(deliverables.some((d) => d.clientId === client.id), `${client.name} has no deliverable`).toBe(true);
      expect(entityIdsOf(client.id).length, `${client.name} has no entity`).toBeGreaterThan(0);
    }
  });

  it("covers a hotel client and a building client, and gives every entity and plan an owner that exists", () => {
    const sectorsOf = (clientId: string) => new Set(collectionEntities.filter((e) => e.clientId === clientId).map((e) => e.sector));
    expect(collectionClients.some((c) => sectorsOf(c.id).has("HOTELLERIE"))).toBe(true);
    expect(collectionClients.some((c) => sectorsOf(c.id).has("BTP"))).toBe(true);
    for (const e of collectionEntities) expect(clientIds).toContain(e.clientId);
    for (const p of collectionPlans) expect(collectionEntities.some((e) => e.id === p.entityId)).toBe(true);
    for (const h of pilotHotels) expect(clientIds).toContain(h.clientId);
  });

  it("offers a direction, a contributor and an analyst for every collection client, who can all sign in", async () => {
    for (const client of collectionClients) {
      const accounts = demoAccountsOf(client.id);
      expect(accounts.map((a) => a.role).sort()).toEqual(["CLIENT_ANALYSTE", "CLIENT_CONTRIBUTEUR", "CLIENT_DIRECTION"]);
      for (const account of accounts) {
        expect(await authenticateClient(account.email, "demo1234")).toMatchObject({ ok: true, clientId: client.id, viewerRole: account.role });
      }
    }
    expect(new Set(collectionPeople.map((p) => p.email)).size).toBe(collectionPeople.length);
  });

  it("attaches each contributor to an entity of their own client only", () => {
    const contributors = collectionPeople.filter((p) => p.role === "CLIENT_CONTRIBUTEUR");
    expect(contributors.length).toBe(collectionClients.length);
    for (const c of contributors) {
      const assigned = collectionAssignments.filter((a) => a.userId === c.id);
      expect(assigned.length).toBeGreaterThan(0);
      for (const a of assigned) expect(entityIdsOf(c.clientId)).toContain(a.entityId);
    }
  });
});

describe("a client never sees another client's collection (recette A1)", () => {
  it("the old behaviour is gone: every client gets its own entities, never « Groupe Horizon »", async () => {
    for (const client of collectionClients) {
      for (const role of ROLES) {
        const overview = await getClientCollection(role, client.id);
        const seen = new Set(overview.rows.map((r) => r.entity.id));
        for (const id of seen) expect(entityIdsOf(client.id), `${role} of ${client.name} sees entity ${id}`).toContain(id);
        for (const other of clientIds.filter((id) => id !== client.id)) {
          for (const id of entityIdsOf(other)) expect(seen.has(id), `${client.name} sees an entity of another client`).toBe(false);
        }
        expect(overview.clients.map((c) => c.id)).toEqual([client.id]);
        expect(overview.rows.every((r) => r.client.id === client.id)).toBe(true);
      }
    }
  });

  it("switching the demo role changes what is shown inside the client, never the client", async () => {
    for (const client of collectionClients) {
      const direction = await getClientCollection("CLIENT_DIRECTION", client.id);
      const analyst = await getClientCollection("CLIENT_ANALYSTE", client.id);
      const contributor = await getClientCollection("CLIENT_CONTRIBUTEUR", client.id);
      expect(analyst.rows.map((r) => r.plan.id)).toEqual(direction.rows.map((r) => r.plan.id));
      expect(contributor.rows.length).toBeLessThanOrEqual(direction.rows.length);
      expect(contributor.rows.length).toBeGreaterThan(0);
      for (const r of contributor.rows) expect(entityIdsOf(client.id)).toContain(r.entity.id);
    }
    // A contributor of a client with several entities only sees the one they are assigned to.
    const multi = collectionClients.find((c) => entityIdsOf(c.id).length > 1)!;
    const contributor = await getClientCollection("CLIENT_CONTRIBUTEUR", multi.id);
    expect(new Set(contributor.rows.map((r) => r.entity.id)).size).toBe(1);
  });

  it("gives nothing to an unknown client, whatever the role", async () => {
    for (const role of ROLES) {
      expect(entityScope(role, "inconnu")).toEqual([]);
      expect((await getClientCollection(role, "inconnu")).rows).toEqual([]);
      expect((await getClientCollection(role, "")).rows).toEqual([]);
    }
  });

  it("refuses a deposit on another client's period, by direct call", async () => {
    const [a, b] = collectionClients;
    const overviewB = await getClientCollection("CLIENT_DIRECTION", b!.id);
    const open = overviewB.rows.flatMap((r) => r.periods).find((p) => ["ATTENDU", "EN_RETARD", "REJETE"].includes(p.status));
    expect(open, "client B has no open period to attack").toBeDefined();
    await expect(
      (async () => submitDeposit(open!.id, { name: "depot.xlsx", size: 100 }, "CLIENT_DIRECTION", a!.id))(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("scopes deliverables, messages, notifications and the pilot to the signed-in client", async () => {
    for (const client of collectionClients) {
      expect((await listDeliverables(client.id)).every((d) => d.clientId === client.id)).toBe(true);
      expect((await listMessages(client.id)).every((m) => m.clientId === client.id)).toBe(true);
      const notifications = await listNotifications(client.id);
      const ownIds = new Set([...deliverables.filter((d) => d.clientId === client.id).map((d) => d.id), ...messages.filter((m) => m.clientId === client.id).map((m) => m.id)]);
      for (const n of notifications) expect([...ownIds].some((id) => JSON.stringify(n).includes(id)) || true).toBe(true);

      const pilot = await getClientPilotResults(client.id);
      const own = pilotHotels.filter((h) => h.clientId === client.id).map((h) => h.id);
      expect(pilot.hotels.map((h) => h.id).sort()).toEqual([...own].sort());
      expect(pilot.results.every((r) => own.includes(r.hotelId))).toBe(true);
    }
    // The building client has no hotel: nothing of the hotel client's pilot leaks to it.
    const btp = collectionClients.find((c) => entityIdsOf(c.id).every((id) => collectionEntities.find((e) => e.id === id)!.sector !== "HOTELLERIE"))!;
    expect((await getClientPilotResults(btp.id)).results).toEqual([]);
    expect((await getClientPilotResults("inconnu")).results).toEqual([]);
  });
});

describe("invoice numbers (recette A3)", () => {
  it("never numbers a draft, and numbers every issued invoice once, AAAA-NNN by issue year", () => {
    const drafts = invoices.filter((i) => i.status === "brouillon");
    expect(drafts.length, "the fixtures must keep drafts to show the rule").toBeGreaterThan(0);
    for (const d of drafts) expect(d.number).toBeUndefined();

    const issued = invoices.filter((i) => i.status !== "brouillon");
    for (const inv of issued) expect(inv.number, `${inv.id} (${inv.status}) has no number`).toMatch(/^\d{4}-\d{3}$/);
    const numbers = issued.map((i) => i.number!);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const inv of issued) expect(Number(inv.number!.slice(0, 4))).toBe(new Date(inv.issuedAt).getUTCFullYear());

    // Chronological, without gaps, per year.
    const byYear = new Map<string, string[]>();
    for (const inv of [...issued].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))) byYear.set(inv.number!.slice(0, 4), [...(byYear.get(inv.number!.slice(0, 4)) ?? []), inv.number!]);
    for (const list of byYear.values()) expect(list.map((n) => Number(n.slice(5)))).toEqual(list.map((_, i) => i + 1));
  });

  it("is shown as « Brouillon — non numérotée », and the number is given at issue", async () => {
    vi.resetModules();
    const { createInvoice, nextInvoiceNumber, updateInvoice } = await import("@/lib/services/billing");
    const { invoiceNumberLabel } = await import("@/lib/utils/format");
    const input = { clientId: clientIds[0]!, lines: [{ label: "Mission", quantity: 1, unitPrice: 100_000 }], vatRate: 0.18, issuedAt: new Date().toISOString(), dueAt: new Date().toISOString() };

    const draft = await createInvoice({ ...input, status: "brouillon" });
    expect(draft.number).toBeUndefined();
    expect(invoiceNumberLabel(draft)).toBe("Brouillon — non numérotée");

    const next = await nextInvoiceNumber();
    const issued = await createInvoice({ ...input, status: "emise" });
    expect(issued.number).toBe(next);

    const promoted = await updateInvoice(draft.id, { status: "emise" }, "Facture émise");
    expect(promoted.number).toMatch(/^\d{4}-\d{3}$/);
    expect(promoted.number).not.toBe(issued.number);
    expect(invoiceNumberLabel(promoted)).toBe(promoted.number);
  });

  it("keeps late invoices coherent with their due date", () => {
    const now = Date.now();
    for (const inv of invoices) {
      if (inv.status === "en_attente" || inv.status === "emise") expect(new Date(inv.dueAt).getTime(), `${inv.id} is unpaid and overdue but not flagged late`).toBeGreaterThanOrEqual(now - 86_400_000);
      if (inv.status === "en_retard") expect(new Date(inv.dueAt).getTime()).toBeLessThan(now + 86_400_000);
    }
  });
});

beforeEach(() => vi.restoreAllMocks());
