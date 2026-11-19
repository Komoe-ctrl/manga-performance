import { inviteClientSchema } from "@manga/validation";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccountFlows } from "@/server/auth/account-flows";
import { createEntityService } from "@/server/collection/entity-service";
import { createPlanService } from "@/server/collection/plan-service";
import { createCollectionReadService, overviewMonths, toReport } from "@/server/collection/read-service";
import type { CollectionActor } from "@/server/collection/scope";
import { createSubmissionService } from "@/server/collection/submission-service";
import { MemoryMailer, createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";
import { MemoryStorage } from "./memory-storage";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = day(2026, 11, 19);
const actorOf = (u: { id: string; role: CollectionActor["role"]; clientId: string | null }): CollectionActor => ({ userId: u.id, role: u.role, clientId: u.clientId });

const read = () => createCollectionReadService({ prisma: db(), now: () => NOW });
const plans = () => createPlanService({ prisma: db() });

async function seed() {
  const clientA = await createClientCompany("Groupe A");
  const clientB = await createClientCompany("Groupe B");
  const a1 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A1", sector: "HOTELLERIE" } });
  const a2 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A2", sector: "HOTELLERIE" } });
  const b1 = await db().entity.create({ data: { clientId: clientB.id, name: "Hôtel B1", sector: "HOTELLERIE" } });
  const plan = (entityId: string, templateId = "hotel_mensuel") => db().collectionPlan.create({ data: { entityId, templateId, startsOn: day(2026, 1, 1) } });
  const period = (planId: string, month: number, status: "VALIDE" | "REJETE" | "EN_RETARD" | "ATTENDU" = "VALIDE") =>
    db().collectionPeriod.create({ data: { planId, periodStart: day(2026, month, 1), periodEnd: day(2026, month + 1, 0), dueAt: day(2026, month + 1, 3), status } });
  const planA1 = await plan(a1.id);
  const planA2 = await plan(a2.id);
  const planB1 = await plan(b1.id);
  const admin = await createUser({ role: "ADMIN" });
  const direction = await createUser({ role: "CLIENT_DIRECTION", clientId: clientA.id, name: "Awa Koné" });
  const contributor = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: clientA.id });
  const analyst = await createUser({ role: "CLIENT_ANALYSTE", clientId: clientA.id });
  await db().entityAssignment.create({ data: { userId: contributor.id, entityId: a1.id } });
  return { clientA, clientB, a1, a2, b1, planA1, planA2, planB1, admin, direction, contributor, analyst, period, plan };
}

beforeEach(resetDatabase);
afterAll(shutdown);

describe("report mapping", () => {
  it("maps the engine's report to what the screens show, and tolerates anything else", () => {
    expect(toReport({ errors: [{ row: 7, columnLabel: "Chambres vendues", value: "125", message: "Ligne 7 : trop" }, { row: null, columnLabel: null, value: null, message: "Fichier" }], warnings: [{ message: "attention" }] })).toEqual({
      errors: [{ row: 7, column: "Chambres vendues", value: "125", message: "Ligne 7 : trop" }, { message: "Fichier" }],
      warnings: [{ message: "attention" }],
    });
    expect(toReport(null)).toBeNull();
    expect(toReport("x")).toBeNull();
    expect(toReport({})).toEqual({ errors: [], warnings: [] });
  });

  it("builds the seven months ending with the current one", () => {
    const months = overviewMonths(NOW);
    expect(months.map((m) => m.key)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(months[6]!.label).toMatch(/nov/i);
  });
});

describe("overview", () => {
  it("shows the admin everything and every role only its own scope", async () => {
    const s = await seed();
    await s.period(s.planA1.id, 10);
    await s.period(s.planA2.id, 10);
    await s.period(s.planB1.id, 10);

    const entities = async (u: { id: string; role: CollectionActor["role"]; clientId: string | null }) => (await read().overview(actorOf(u))).rows.map((r) => r.entity.name).sort();
    expect(await entities(s.admin)).toEqual(["Hôtel A1", "Hôtel A2", "Hôtel B1"]);
    expect(await entities(s.direction)).toEqual(["Hôtel A1", "Hôtel A2"]);
    expect(await entities(s.analyst)).toEqual(["Hôtel A1", "Hôtel A2"]);
    expect(await entities(s.contributor)).toEqual(["Hôtel A1"]);
    const forDirection = await read().overview(actorOf(s.direction));
    expect(forDirection.clients).toEqual([{ id: s.clientA.id, name: "Groupe A" }]);
  });

  it("maps plans, templates, periods, submissions, reports, reserves and reminders", async () => {
    const s = await seed();
    const period = await s.period(s.planA1.id, 10, "REJETE");
    const uploader = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: s.clientA.id, name: "Moussa Traoré" });
    await db().submission.create({
      data: { periodId: period.id, version: 1, templateId: "hotel_mensuel", templateVersion: 1, storageKey: "k1", originalName: "oct.xlsx", sizeBytes: 10, checksum: "x", uploadedBy: uploader.id, status: "REJETE", report: { errors: [{ row: 2, columnLabel: "Nombre de chambres", value: "0", message: "Ligne 2 : invalide" }], warnings: [] } },
    });
    await db().submission.create({ data: { periodId: period.id, version: 2, templateId: "hotel_mensuel", templateVersion: 1, storageKey: "k2", originalName: "oct2.xlsx", sizeBytes: 10, checksum: "y", uploadedBy: uploader.id, status: "ERREUR_TECHNIQUE" } });
    await db().auditLog.createMany({
      data: [
        { actorId: null, action: "collection.reminder", entity: "CollectionPeriod", entityId: period.id, diff: { kind: "J+1", escalation: false } },
        { actorId: s.admin.id, action: "collection.reminder", entity: "CollectionPeriod", entityId: period.id, diff: { kind: "MANUELLE", escalation: false } },
        { actorId: null, action: "collection.reminder", entity: "CollectionPeriod", entityId: period.id, diff: { kind: "J+5", escalation: true } },
      ],
    });

    const row = (await read().overview(actorOf(s.admin))).rows.find((r) => r.entity.id === s.a1.id)!;
    expect(row.template).toEqual({ id: "hotel_mensuel", label: "Hôtel — KPI mensuels", sector: "HOTELLERIE" });
    expect(row.plan).toMatchObject({ frequency: "MENSUELLE", delayDays: 3, active: true });
    expect(row.client.name).toBe("Groupe A");
    const p = row.periods[0]!;
    expect(p).toMatchObject({ status: "REJETE", periodStart: "2026-10-01T00:00:00.000Z", dueAt: "2026-11-03T00:00:00.000Z" });
    expect(p.submissions).toHaveLength(1); // the technical failure is not shown as a deposit
    expect(p.submissions[0]).toMatchObject({ version: 1, originalName: "oct.xlsx", uploadedBy: "Moussa Traoré", status: "REJETE", report: { errors: [{ row: 2, column: "Nombre de chambres", value: "0" }] } });
    expect(p.reminders.map((r) => [r.kind, r.recipients])).toEqual([
      ["J+1", "Contributeurs de l'entité"],
      ["MANUELLE", "Contributeurs de l'entité"],
      ["J+5", "Contributeurs et direction du client"],
    ]);
  });

  it("keeps the months window and leaves out plans whose template no longer exists", async () => {
    const s = await seed();
    await s.period(s.planA1.id, 2); // February: older than the window
    await s.period(s.planA1.id, 10);
    await s.plan(s.a1.id, "supprime");
    const rows = (await read().overview(actorOf(s.admin))).rows.filter((r) => r.entity.id === s.a1.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.periods.map((p) => p.periodStart.slice(0, 7))).toEqual(["2026-10"]);
  });
});

describe("period detail", () => {
  it("loads a period within the scope and answers the same for another client's or a missing one", async () => {
    const s = await seed();
    const mine = await s.period(s.planA1.id, 10);
    const theirs = await s.period(s.planB1.id, 10);
    const detail = await read().periodDetail(actorOf(s.direction), mine.id);
    expect(detail.period.id).toBe(mine.id);
    expect(detail.row.entity.name).toBe("Hôtel A1");
    for (const id of [theirs.id, "does-not-exist"]) await expect(read().periodDetail(actorOf(s.direction), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(read().periodDetail(actorOf(s.contributor), (await s.period(s.planA2.id, 10)).id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("also loads a period older than the overview window", async () => {
    const s = await seed();
    const old = await s.period(s.planA1.id, 2);
    const uploader = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: s.clientA.id, name: "Awa" });
    await db().submission.create({ data: { periodId: old.id, version: 1, templateId: "hotel_mensuel", templateVersion: 1, storageKey: "old", originalName: "fev.xlsx", sizeBytes: 1, checksum: "x", uploadedBy: uploader.id, status: "VALIDE" } });
    await db().auditLog.create({ data: { actorId: null, action: "collection.reminder", entity: "CollectionPeriod", entityId: old.id, diff: { kind: "J+3" } } });
    const detail = await read().periodDetail(actorOf(s.admin), old.id);
    expect(detail.period.periodStart).toBe("2026-02-01T00:00:00.000Z");
    expect(detail.period.submissions[0]).toMatchObject({ originalName: "fev.xlsx", uploadedBy: "Awa" });
    expect(detail.period.reminders).toHaveLength(1);
  });
});

describe("entities and plans (admin screen)", () => {
  it("lists every entity with its plans, and every client even when it has no entity yet", async () => {
    const s = await seed();
    const empty = await createClientCompany("Groupe Vide");
    const data = await read().entitiesAndPlans(actorOf(s.admin));
    expect(data.entities.map((e) => e.name).sort()).toEqual(["Hôtel A1", "Hôtel A2", "Hôtel B1"]);
    expect(data.plans).toHaveLength(3);
    expect(data.clients.map((c) => c.name)).toContain("Groupe Vide");
    expect(data.clients.find((c) => c.id === empty.id)).toBeTruthy();
    const mine = await read().entitiesAndPlans(actorOf(s.direction));
    expect(mine.clients.map((c) => c.name)).toEqual(["Groupe A"]);
  });
});

describe("plans", () => {
  const input = (entityId: string, over: Record<string, unknown> = {}) => ({ entityId, templateId: "hotel_consommables_cpro", frequency: "MENSUELLE" as const, delayDays: 3, startsOn: "2026-10-01", ...over });

  it("creates a plan for an entity and a template of its sector, and audits it", async () => {
    const s = await seed();
    const plan = await plans().createPlan(input(s.a1.id), s.admin.id);
    expect(plan).toMatchObject({ entityId: s.a1.id, templateId: "hotel_consommables_cpro", frequency: "MENSUELLE", delayDays: 3, startsOn: "2026-10-01T00:00:00.000Z", active: true });
    expect(await db().auditLog.count({ where: { action: "plan.create", entityId: plan.id, actorId: s.admin.id } })).toBe(1);
  });

  it("refuses a wrong sector, a duplicate, bad values and unknown things", async () => {
    const s = await seed();
    await expect(plans().createPlan(input(s.a1.id, { templateId: "resto_mensuel" }), s.admin.id)).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("secteur") });
    await expect(plans().createPlan(input(s.a1.id, { templateId: "hotel_mensuel" }), s.admin.id)).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(plans().createPlan(input(s.a1.id, { templateId: "inconnu" }), s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(plans().createPlan(input(s.a1.id, { frequency: "ANNUELLE" }), s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(plans().createPlan(input(s.a1.id, { delayDays: 31 }), s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(plans().createPlan(input(s.a1.id, { delayDays: 1.5 }), s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    for (const startsOn of ["2026-02-30", "octobre", "2026-1-1"]) await expect(plans().createPlan(input(s.a1.id, { startsOn }), s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(plans().createPlan(input("nope"), s.admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("suspends and resumes a plan, audited", async () => {
    const s = await seed();
    expect((await plans().setPlanActive(s.planA1.id, false, s.admin.id)).active).toBe(false);
    expect((await plans().setPlanActive(s.planA1.id, true, s.admin.id)).active).toBe(true);
    expect(await db().auditLog.count({ where: { action: { in: ["plan.suspend", "plan.resume"] }, entityId: s.planA1.id } })).toBe(2);
    await expect(plans().setPlanActive("nope", false, s.admin.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("reminder rules", () => {
  const rules = { beforeDue: 2, afterDue: [1, 3], escalationDay: 5, cap: 4, sendHour: 8 };

  it("returns the defaults until saved, then the saved rules, and audits the change", async () => {
    const s = await seed();
    expect(await plans().getReminderRules()).toEqual(rules);
    const saved = await plans().saveReminderRules({ beforeDue: 1, afterDue: [4, 2, 2], escalationDay: 6, cap: 3, sendHour: 9 }, s.admin.id);
    expect(saved).toEqual({ beforeDue: 1, afterDue: [2, 4], escalationDay: 6, cap: 3, sendHour: 9 });
    expect(await plans().getReminderRules()).toEqual(saved);
    expect(await db().auditLog.count({ where: { action: "collection.reminder_rules" } })).toBe(1);
  });

  it("refuses values out of range instead of correcting them silently", async () => {
    const s = await seed();
    for (const bad of [{ cap: 0 }, { cap: 11 }, { beforeDue: 31 }, { afterDue: [0] }, { afterDue: [1, 2, 3, 4, 5, 6, 7] }, { afterDue: [1.5] }, { escalationDay: 0 }, { sendHour: 24 }, { sendHour: -1 }, { beforeDue: 1.5 }]) {
      await expect(plans().saveReminderRules({ ...rules, ...bad }, s.admin.id)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await db().setting.count({ where: { key: "collection.reminders" } })).toBe(0);
  });
});

describe("people and assignments (admin screen)", () => {
  it("lists the client accounts and the contributors' assignments, narrowed to the scope", async () => {
    const s = await seed();
    const other = await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: s.clientB.id });
    await db().entityAssignment.create({ data: { userId: other.id, entityId: s.b1.id } });
    const service = createEntityService({ prisma: db() });

    const all = await service.listPeople(actorOf(s.admin));
    expect(all.users.map((u) => u.role).sort()).toEqual(["CLIENT_ANALYSTE", "CLIENT_CONTRIBUTEUR", "CLIENT_CONTRIBUTEUR", "CLIENT_DIRECTION"]);
    expect(all.assignments).toHaveLength(2);

    const mine = await service.listPeople(actorOf(s.direction));
    expect(mine.users.every((u) => u.clientId === s.clientA.id)).toBe(true);
    expect(mine.users.some((u) => u.id === other.id)).toBe(false);
    expect(mine.assignments).toEqual([{ userId: s.contributor.id, entityId: s.a1.id }]);
    expect(mine.users.find((u) => u.id === s.direction.id)).toMatchObject({ name: "Awa Koné", active: true });
  });
});

describe("downloading an original file", () => {
  it("gives a short-lived link within the scope, and a 404 outside", async () => {
    const s = await seed();
    const storage = new MemoryStorage();
    const service = createSubmissionService({ prisma: db(), storage, queue: { enqueueParseSubmission: async () => undefined } });
    const mine = await s.period(s.planA1.id, 10);
    const theirs = await s.period(s.planB1.id, 10);
    const make = (periodId: string, key: string) => db().submission.create({ data: { periodId, version: 1, templateId: "hotel_mensuel", templateVersion: 1, storageKey: key, originalName: "Octobre 2026.xlsx", sizeBytes: 1, checksum: "x", uploadedBy: "u", status: "VALIDE" } });
    const sub = await make(mine.id, "clients/a/1.xlsx");
    const other = await make(theirs.id, "clients/b/1.xlsx");

    const link = await service.downloadOriginal(actorOf(s.direction), sub.id);
    expect(link.filename).toBe("Octobre 2026.xlsx");
    expect(link.url).toContain("clients/a/1.xlsx");
    expect(storage.downloads[0]).toMatchObject({ key: "clients/a/1.xlsx", filename: "Octobre 2026.xlsx" });
    await expect(service.downloadOriginal(actorOf(s.analyst), sub.id)).resolves.toBeTruthy();
    for (const id of [other.id, "nope"]) await expect(service.downloadOriginal(actorOf(s.direction), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const a2 = await make((await s.period(s.planA2.id, 10)).id, "clients/a/2.xlsx");
    await expect(service.downloadOriginal(actorOf(s.contributor), a2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("invitation with a role", () => {
  const flows = () => createAccountFlows({ prisma: db(), mailer: new MemoryMailer(), appUrl: "https://app.example.com", now: () => NOW });

  it("creates the account with the chosen role, direction by default", async () => {
    const client = await createClientCompany("Acme");
    await flows().inviteClientUser({ clientId: client.id, email: "a@acme.ci", name: "A", role: "CLIENT_CONTRIBUTEUR" });
    await flows().inviteClientUser({ clientId: client.id, email: "b@acme.ci", name: "B" });
    expect((await db().user.findUniqueOrThrow({ where: { email: "a@acme.ci" } })).role).toBe("CLIENT_CONTRIBUTEUR");
    expect((await db().user.findUniqueOrThrow({ where: { email: "b@acme.ci" } })).role).toBe("CLIENT_DIRECTION");
  });

  it("validates the role in the schema, and never accepts the admin role", () => {
    const base = { clientId: "c1", email: "a@acme.ci", name: "A" };
    expect(inviteClientSchema.parse(base).role).toBe("CLIENT_DIRECTION");
    expect(inviteClientSchema.parse({ ...base, role: "CLIENT_ANALYSTE" }).role).toBe("CLIENT_ANALYSTE");
    expect(inviteClientSchema.safeParse({ ...base, role: "ADMIN" }).success).toBe(false);
    expect(inviteClientSchema.safeParse({ ...base, role: "CLIENT" }).success).toBe(false);
  });
});
