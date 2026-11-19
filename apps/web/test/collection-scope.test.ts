import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requireClient } from "@/server/auth/guards";
import { createEntityService } from "@/server/collection/entity-service";
import { assertCanDeposit, assertEntityInScope, entityScope, type CollectionActor } from "@/server/collection/scope";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});

const service = () => createEntityService({ prisma: db() });
const actorOf = (u: { id: string; role: CollectionActor["role"]; clientId: string | null }): CollectionActor => ({ userId: u.id, role: u.role, clientId: u.clientId });

/** Two client companies: A has two hotels, B has one. */
async function seed() {
  const clientA = await createClientCompany("Groupe A");
  const clientB = await createClientCompany("Groupe B");
  const admin = await createUser({ role: "ADMIN" });
  const a1 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A1", sector: "HOTELLERIE" } });
  const a2 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A2", sector: "HOTELLERIE" } });
  const b1 = await db().entity.create({ data: { clientId: clientB.id, name: "Hôtel B1", sector: "HOTELLERIE" } });
  const directionA = await createUser({ role: "CLIENT_DIRECTION", clientId: clientA.id });
  const analystA = await createUser({ role: "CLIENT_ANALYSTE", clientId: clientA.id });
  const contributorA = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: clientA.id });
  const contributorB = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: clientB.id });
  const directionB = await createUser({ role: "CLIENT_DIRECTION", clientId: clientB.id });
  await db().entityAssignment.create({ data: { userId: contributorA.id, entityId: a1.id } });
  await db().entityAssignment.create({ data: { userId: contributorB.id, entityId: b1.id } });
  return { clientA, clientB, admin, a1, a2, b1, directionA, analystA, contributorA, contributorB, directionB };
}

beforeEach(async () => {
  await resetDatabase();
  actAs(null);
});
afterAll(shutdown);

describe("entityScope", () => {
  it("gives the admin every entity", async () => {
    const s = await seed();
    expect((await entityScope(db(), actorOf(s.admin))).sort()).toEqual([s.a1.id, s.a2.id, s.b1.id].sort());
  });

  it("gives direction and analyst the whole of their own client, and nothing of another client", async () => {
    const s = await seed();
    for (const user of [s.directionA, s.analystA]) {
      expect((await entityScope(db(), actorOf(user))).sort()).toEqual([s.a1.id, s.a2.id].sort());
    }
    expect(await entityScope(db(), actorOf(s.directionB))).toEqual([s.b1.id]);
  });

  it("gives a contributor only the entities they are assigned to", async () => {
    const s = await seed();
    expect(await entityScope(db(), actorOf(s.contributorA))).toEqual([s.a1.id]);
    expect(await entityScope(db(), actorOf(s.contributorB))).toEqual([s.b1.id]);
  });

  it("gives nothing to a contributor without assignment, or to a user without client", async () => {
    const s = await seed();
    const lonely = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: s.clientA.id });
    expect(await entityScope(db(), actorOf(lonely))).toEqual([]);
    expect(await entityScope(db(), { userId: "x", role: "CLIENT_DIRECTION", clientId: null })).toEqual([]);
  });

  it("ignores an assignment that points to another client's entity (defence in depth)", async () => {
    const s = await seed();
    // Not reachable through the service (it refuses), but a stray row must not open the door.
    await db().entityAssignment.create({ data: { userId: s.contributorA.id, entityId: s.b1.id } });
    expect(await entityScope(db(), actorOf(s.contributorA))).toEqual([s.a1.id]);
  });
});

describe("entity access", () => {
  it("lets a contributor of entity A1 neither see nor load entity A2 of the same client", async () => {
    const s = await seed();
    const actor = actorOf(s.contributorA);
    expect((await service().listEntities(actor)).map((e) => e.id)).toEqual([s.a1.id]);
    expect(await service().getEntity(actor, s.a1.id)).toMatchObject({ name: "Hôtel A1" });
    expect(await service().getEntity(actor, s.a2.id)).toBeNull();
    await expect(assertEntityInScope(db(), actor, s.a2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers the same way for another client's entity and for one that does not exist", async () => {
    const s = await seed();
    for (const actor of [actorOf(s.directionA), actorOf(s.contributorA), actorOf(s.analystA)]) {
      expect(await service().getEntity(actor, s.b1.id)).toBeNull();
      expect(await service().getEntity(actor, "does-not-exist")).toBeNull();
      expect((await service().listEntities(actor)).some((e) => e.id === s.b1.id)).toBe(false);
    }
  });

  it("lets the admin load any entity", async () => {
    const s = await seed();
    expect(await service().getEntity(actorOf(s.admin), s.b1.id)).toMatchObject({ name: "Hôtel B1" });
  });
});

describe("roles", () => {
  it("refuses deposits from the analyst only", async () => {
    const s = await seed();
    expect(() => assertCanDeposit(actorOf(s.analystA))).toThrowError(/lecture seule/);
    for (const user of [s.directionA, s.contributorA, s.admin]) expect(() => assertCanDeposit(actorOf(user))).not.toThrow();
  });

  it("lets every client role into the client space, scoped to their own client", async () => {
    const s = await seed();
    for (const user of [s.directionA, s.contributorA, s.analystA]) {
      actAs((await login(user.email)).cookie);
      const session = await requireClient();
      expect(session.role).toBe(user.role);
      expect(session.clientId).toBe(s.clientA.id);
    }
    actAs((await login(s.admin.email)).cookie);
    await expect(requireClient()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gives new users the direction role by default (the former CLIENT)", async () => {
    const client = await createClientCompany("Groupe C");
    const user = await db().user.create({ data: { email: "c@example.com", name: "C", clientId: client.id } });
    expect(user.role).toBe("CLIENT_DIRECTION");
  });
});

describe("assignments", () => {
  it("assigns a contributor of the same client and audits it", async () => {
    const s = await seed();
    const another = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: s.clientA.id });
    await service().assignContributor(s.a2.id, another.id, s.admin.id);
    expect(await entityScope(db(), actorOf(another))).toEqual([s.a2.id]);
    expect(await db().auditLog.count({ where: { action: "entity.assign", entityId: s.a2.id, actorId: s.admin.id } })).toBe(1);

    await service().unassignContributor(s.a2.id, another.id, s.admin.id);
    expect(await entityScope(db(), actorOf(another))).toEqual([]);
    expect(await db().auditLog.count({ where: { action: "entity.unassign", entityId: s.a2.id } })).toBe(1);
  });

  it("refuses to attach a contributor to another client's entity", async () => {
    const s = await seed();
    await expect(service().assignContributor(s.b1.id, s.contributorA.id, s.admin.id)).rejects.toMatchObject({ code: "OTHER_CLIENT" });
  });

  it("refuses users who are not contributors, and unknown entities", async () => {
    const s = await seed();
    await expect(service().assignContributor(s.a2.id, s.directionA.id, s.admin.id)).rejects.toMatchObject({ code: "NOT_CONTRIBUTOR" });
    await expect(service().assignContributor(s.a2.id, s.analystA.id, s.admin.id)).rejects.toMatchObject({ code: "NOT_CONTRIBUTOR" });
    await expect(service().assignContributor("nope", s.contributorA.id, s.admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is idempotent", async () => {
    const s = await seed();
    await service().assignContributor(s.a1.id, s.contributorA.id, s.admin.id);
    expect(await db().entityAssignment.count({ where: { userId: s.contributorA.id } })).toBe(1);
  });
});

describe("entity creation", () => {
  it("creates an entity for an existing client and refuses duplicates and unknown clients", async () => {
    const s = await seed();
    const created = await service().createEntity({ clientId: s.clientA.id, name: "  Hôtel A3  ", sector: "HOTELLERIE" }, s.admin.id);
    expect(created.name).toBe("Hôtel A3");
    expect(await db().auditLog.count({ where: { action: "entity.create", entityId: created.id } })).toBe(1);
    await expect(service().createEntity({ clientId: s.clientA.id, name: "Hôtel A3", sector: "HOTELLERIE" }, s.admin.id)).rejects.toMatchObject({ code: "DUPLICATE" });
    // The same name is fine for another client.
    await expect(service().createEntity({ clientId: s.clientB.id, name: "Hôtel A3", sector: "HOTELLERIE" }, s.admin.id)).resolves.toBeTruthy();
    await expect(service().createEntity({ clientId: "nope", name: "X Y", sector: "BTP" }, s.admin.id)).rejects.toMatchObject({ code: "CLIENT_NOT_FOUND" });
    await expect(service().createEntity({ clientId: s.clientA.id, name: " ", sector: "BTP" }, s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
