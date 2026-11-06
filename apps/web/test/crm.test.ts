import type { PrismaClient } from "@manga/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccountFlows } from "@/server/auth/account-flows";
import { createCrmService } from "@/server/crm/crm-service";
import { CrmError } from "@/server/crm/errors";
import {
  MemoryMailer,
  createUser,
  db,
  login,
  PASSWORD,
  resetDatabase,
  shutdown,
  tokenFromUrl,
  tryLogin,
} from "./helpers";

const DAY = 24 * 3600_000;
let mailer: MemoryMailer;
let clock: Date;
let actorId: string;

const flows = () =>
  createAccountFlows({ prisma: db(), mailer, appUrl: "https://app.example.com", now: () => clock });

const crm = (prisma: PrismaClient = db()) =>
  createCrmService({ prisma, flows: flows(), now: () => clock });

const base = {
  companyName: "Lagune Hôtel SARL",
  contactName: "Awa Koné",
  email: "awa@lagune.ci",
  phone: "07 01 02 03 04",
  sector: "Hôtellerie",
  city: "Abidjan",
  size: "pme" as const,
  need: "audit" as const,
  source: "manuel" as const,
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CrmError) return error;
    throw error;
  }
  throw new Error("expected a CrmError");
};

beforeEach(async () => {
  await resetDatabase();
  mailer = new MemoryMailer();
  clock = new Date("2026-11-06T09:00:00Z");
  actorId = (await createUser({ role: "ADMIN" })).id;
});
afterAll(shutdown);

describe("createProspect", () => {
  it("normalises contact data and returns the front shape", async () => {
    const prospect = await crm().createProspect({ ...base, email: "Awa@Lagune.CI" }, actorId);
    expect(prospect).toMatchObject({
      companyName: "Lagune Hôtel SARL",
      email: "awa@lagune.ci",
      phone: "+2250701020304",
      status: "nouveau",
      source: "manuel",
      size: "pme",
      need: "audit",
    });
    const row = await db().prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(row.companyNameNorm).toBe("lagune hotel");
  });

  it("rejects an invalid phone number", async () => {
    const error = await failure(crm().createProspect({ ...base, phone: "12" }, actorId));
    expect(error.code).toBe("INVALID");
  });

  it("schedules follow-ups from the settings (J+7 and J+15 by default)", async () => {
    const prospect = await crm().createProspect(base, actorId);
    const followUps = await db().followUp.findMany({
      where: { prospectId: prospect.id },
      orderBy: { dueAt: "asc" },
    });
    expect(followUps.map((f) => f.rule)).toEqual(["J+7", "J+15"]);
    expect(followUps[0]!.dueAt).toEqual(new Date(clock.getTime() + 7 * DAY));
    expect(prospect.nextFollowUpAt).toBe(new Date(clock.getTime() + 7 * DAY).toISOString());
  });

  it("follows the rules saved in the settings", async () => {
    const settings = await crm().getSettings();
    await crm().saveSettings({ ...settings, followUps: { j7: false, j15: false, j30: true } }, actorId);
    const prospect = await crm().createProspect(base, actorId);
    const rules = (await db().followUp.findMany({ where: { prospectId: prospect.id } })).map((f) => f.rule);
    expect(rules).toEqual(["J+30"]);
  });

  it("writes an audit entry", async () => {
    const prospect = await crm().createProspect(base, actorId);
    const log = await db().auditLog.findFirstOrThrow({ where: { entityId: prospect.id } });
    expect(log).toMatchObject({ action: "prospect.created", actorId });
  });

  it("creates a prospect directly as a client through the conversion path", async () => {
    const prospect = await crm().createProspect({ ...base, status: "client" }, actorId);
    expect(prospect.status).toBe("client");
    expect(await db().client.count({ where: { prospectId: prospect.id } })).toBe(1);
    expect(await db().followUp.count({ where: { prospectId: prospect.id } })).toBe(0);
  });
});

describe("deduplication", () => {
  beforeEach(async () => {
    await crm().createProspect(base, actorId);
  });

  it("detects the same email, whatever the case", async () => {
    const error = await failure(
      crm().createProspect({ ...base, companyName: "Autre", phone: undefined, email: "AWA@lagune.ci" }, actorId),
    );
    expect(error).toMatchObject({ code: "DUPLICATE" });
    expect(error.details?.existingId).toBeTruthy();
  });

  it("detects the same phone in any written form", async () => {
    const error = await failure(
      crm().createProspect({ ...base, companyName: "Autre", email: undefined, phone: "+225 0701020304" }, actorId),
    );
    expect(error.code).toBe("DUPLICATE");
  });

  it("detects a very similar company name, ignoring accents and legal form", async () => {
    const error = await failure(
      crm().createProspect(
        { ...base, companyName: "LAGUNE HOTELS S.A.", email: undefined, phone: undefined },
        actorId,
      ),
    );
    expect(error.code).toBe("DUPLICATE");
  });

  it("accepts genuinely different companies", async () => {
    const other = await crm().createProspect(
      { ...base, companyName: "Baobab Construction", email: "x@baobab.ci", phone: "05 55 55 55 55" },
      actorId,
    );
    expect(other.id).toBeTruthy();
  });

  it("ignores soft-deleted prospects", async () => {
    await db().prospect.updateMany({ data: { deletedAt: new Date() } });
    const again = await crm().createProspect(base, actorId);
    expect(again.id).toBeTruthy();
  });
});

describe("status changes", () => {
  it("cancels pending follow-ups and stops active sequences when a prospect is lost", async () => {
    const prospect = await crm().createProspect(base, actorId);
    const sequence = await db().emailSequence.create({ data: { name: "S", trigger: "MANUAL", active: true } });
    await db().sequenceEnrollment.create({
      data: { sequenceId: sequence.id, prospectId: prospect.id, status: "ACTIVE", nextSendAt: clock },
    });

    await crm().updateProspectStatus(prospect.id, "perdu", {}, actorId);

    const followUps = await db().followUp.findMany({ where: { prospectId: prospect.id } });
    expect(followUps.every((f) => f.cancelledAt !== null)).toBe(true);
    const enrollment = await db().sequenceEnrollment.findFirstOrThrow({ where: { prospectId: prospect.id } });
    expect(enrollment).toMatchObject({ status: "STOPPED", nextSendAt: null });
    expect((await crm().listFollowUps()).filter((f) => f.prospectId === prospect.id)).toHaveLength(0);
  });

  it("keeps follow-ups when moving between open statuses", async () => {
    const prospect = await crm().createProspect(base, actorId);
    const updated = await crm().updateProspectStatus(prospect.id, "en_negociation", {}, actorId);
    expect(updated.status).toBe("en_negociation");
    expect(await db().followUp.count({ where: { prospectId: prospect.id, cancelledAt: null } })).toBe(2);
  });

  it("does not complete or cancel follow-ups that are already done", async () => {
    const prospect = await crm().createProspect(base, actorId);
    const [first] = await crm().listFollowUps();
    await crm().completeFollowUp(first!.id);
    await crm().updateProspectStatus(prospect.id, "perdu", {}, actorId);
    const done = await db().followUp.findUniqueOrThrow({ where: { id: first!.id } });
    expect(done.doneAt).not.toBeNull();
    expect(done.cancelledAt).toBeNull();
  });

  it("audits every transition", async () => {
    const prospect = await crm().createProspect(base, actorId);
    await crm().updateProspectStatus(prospect.id, "en_negociation", {}, actorId);
    const log = await db().auditLog.findFirstOrThrow({
      where: { entityId: prospect.id, action: "prospect.status_changed" },
    });
    expect(log.diff).toEqual({ from: "NOUVEAU", to: "EN_NEGOCIATION" });
  });

  it("reports an unknown prospect", async () => {
    expect((await failure(crm().updateProspectStatus("nope", "perdu", {}, actorId))).code).toBe("NOT_FOUND");
  });
});

describe("conversion to client", () => {
  it("creates the client, stamps convertedAt and cancels follow-ups, in one go", async () => {
    const prospect = await crm().createProspect(base, actorId);
    clock = new Date("2026-11-10T09:00:00Z");
    const converted = await crm().updateProspectStatus(prospect.id, "client", {}, actorId);

    expect(converted.status).toBe("client");
    const row = await db().prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(row.convertedAt).toEqual(clock);
    const client = await db().client.findUniqueOrThrow({ where: { prospectId: prospect.id } });
    expect(client.legalName).toBe("Lagune Hôtel SARL");
    expect(await db().followUp.count({ where: { prospectId: prospect.id, cancelledAt: null } })).toBe(0);
    expect(await db().auditLog.count({ where: { action: "prospect.converted", entityId: client.id } })).toBe(1);
    // No portal access is created implicitly.
    expect(await db().user.count({ where: { clientId: client.id } })).toBe(0);
    expect(mailer.invitations).toHaveLength(0);
  });

  it("is idempotent, even when triggered twice at once", async () => {
    const prospect = await crm().createProspect(base, actorId);
    await Promise.all([
      crm().updateProspectStatus(prospect.id, "client", {}, actorId),
      crm().updateProspectStatus(prospect.id, "client", {}, actorId),
    ]);
    expect(await db().client.count({ where: { prospectId: prospect.id } })).toBe(1);
  });

  it("refuses to turn a client back into a prospect", async () => {
    const prospect = await crm().createProspect({ ...base, status: "client" }, actorId);
    const error = await failure(crm().updateProspectStatus(prospect.id, "nouveau", {}, actorId));
    expect(error.code).toBe("CLIENT_LOCKED");
  });

  it("rolls back entirely if a step fails mid-conversion", async () => {
    const prospect = await crm().createProspect(base, actorId);
    // A prisma whose transaction client fails when the client record is created.
    const failing = new Proxy(db(), {
      get(target, prop, receiver) {
        if (prop !== "$transaction") return Reflect.get(target, prop, receiver);
        return (callback: (tx: unknown) => Promise<unknown>) =>
          target.$transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  if (txProp === "client") {
                    return { upsert: async () => { throw new Error("boom"); } };
                  }
                  return Reflect.get(txTarget, txProp, txReceiver);
                },
              }),
            ),
          );
      },
    }) as PrismaClient;

    await expect(crm(failing).updateProspectStatus(prospect.id, "client", {}, actorId)).rejects.toThrow("boom");

    expect((await db().prospect.findUniqueOrThrow({ where: { id: prospect.id } })).status).toBe("NOUVEAU");
    expect((await db().prospect.findUniqueOrThrow({ where: { id: prospect.id } })).convertedAt).toBeNull();
    expect(await db().followUp.count({ where: { prospectId: prospect.id, cancelledAt: null } })).toBe(2);
    expect(await db().auditLog.count({ where: { action: "prospect.status_changed" } })).toBe(0);
  });
});

describe("client portal access", () => {
  it("invites the contact only when asked explicitly, and audits it", async () => {
    const prospect = await crm().createProspect(base, actorId);
    await crm().updateProspectStatus(prospect.id, "client", { createAccess: true }, actorId);

    expect(mailer.invitations.map((m) => m.to)).toEqual(["awa@lagune.ci"]);
    const user = await db().user.findUniqueOrThrow({ where: { email: "awa@lagune.ci" } });
    expect(user.role).toBe("CLIENT");
    expect(await db().auditLog.count({ where: { action: "client.access.granted" } })).toBe(1);
  });

  it("refuses to create access without an email, and does not convert", async () => {
    const prospect = await crm().createProspect({ ...base, email: undefined }, actorId);
    const error = await failure(crm().updateProspectStatus(prospect.id, "client", { createAccess: true }, actorId));
    expect(error.code).toBe("NO_EMAIL");
    expect((await db().prospect.findUniqueOrThrow({ where: { id: prospect.id } })).status).toBe("NOUVEAU");
    expect(await db().client.count()).toBe(0);
  });

  it("lists clients with their access state", async () => {
    const prospect = await crm().createProspect({ ...base, status: "client" }, actorId);
    expect(await crm().listClients()).toMatchObject([{ id: prospect.id, accessActive: false, deliverablesCount: 0 }]);
    await crm().setClientAccess(prospect.id, true, actorId);
    expect(await crm().listClients()).toMatchObject([{ id: prospect.id, accessActive: true }]);
  });

  it("revokes access: sessions end, sign-in is refused, and it can be restored", async () => {
    const prospect = await crm().createProspect({ ...base, status: "client" }, actorId);
    await crm().setClientAccess(prospect.id, true, actorId);
    const user = await db().user.findUniqueOrThrow({ where: { email: "awa@lagune.ci" } });
    await flows().acceptInvitation(tokenFromUrl(mailer.invitations[0]!.url), PASSWORD);
    await login(user.email);
    expect(await db().session.count({ where: { userId: user.id } })).toBe(1);

    await crm().setClientAccess(prospect.id, false, actorId);
    expect(await db().session.count({ where: { userId: user.id } })).toBe(0);
    expect(await tryLogin(user.email, PASSWORD)).toEqual({ ok: false, status: "FORBIDDEN" });
    expect((await crm().listClients())[0]!.accessActive).toBe(false);

    await crm().setClientAccess(prospect.id, true, actorId);
    expect((await tryLogin(user.email, PASSWORD)).ok).toBe(true);
    expect(await db().auditLog.count({ where: { action: "client.access.revoked" } })).toBe(1);
  });

  it("rejects access changes for a prospect that is not a client", async () => {
    const prospect = await crm().createProspect(base, actorId);
    expect((await failure(crm().setClientAccess(prospect.id, true, actorId))).code).toBe("NOT_A_CLIENT");
    expect((await failure(crm().setClientAccess(prospect.id, false, actorId))).code).toBe("NOT_A_CLIENT");
  });
});

describe("interactions and follow-ups", () => {
  it("records interactions, newest first", async () => {
    const prospect = await crm().createProspect(base, actorId);
    await crm().addInteraction({ prospectId: prospect.id, type: "appel", summary: "Premier appel", date: "2026-11-06T10:00:00Z" }, actorId);
    await crm().addInteraction({ prospectId: prospect.id, type: "email", summary: "Devis envoyé", date: "2026-11-07T10:00:00Z" }, actorId);
    const list = await crm().listInteractions(prospect.id);
    expect(list.map((i) => [i.type, i.summary])).toEqual([
      ["email", "Devis envoyé"],
      ["appel", "Premier appel"],
    ]);
    expect((await db().interaction.findFirstOrThrow()).createdBy).toBe(actorId);
  });

  it("adds manual follow-ups and completes them (idempotently)", async () => {
    const prospect = await crm().createProspect(base, actorId);
    const added = await crm().addFollowUp({ prospectId: prospect.id, dueAt: "2026-11-20T09:00:00Z", rule: "manuel" });
    expect(added).toMatchObject({ rule: "manuel", done: false });
    const first = await crm().completeFollowUp(added.id);
    expect(first?.done).toBe(true);
    clock = new Date(clock.getTime() + DAY);
    await crm().completeFollowUp(added.id);
    expect((await db().followUp.findUniqueOrThrow({ where: { id: added.id } })).doneAt).toEqual(
      new Date("2026-11-06T09:00:00Z"),
    );
    expect(await crm().completeFollowUp("unknown")).toBeNull();
  });

  it("rejects interactions and follow-ups on unknown prospects", async () => {
    expect((await failure(crm().addInteraction({ prospectId: "nope", type: "note", summary: "x", date: "2026-11-06T10:00:00Z" }, actorId))).code).toBe("NOT_FOUND");
    expect((await failure(crm().addFollowUp({ prospectId: "nope", dueAt: "2026-11-20T09:00:00Z", rule: "manuel" }))).code).toBe("NOT_FOUND");
  });
});

describe("settings", () => {
  it("returns defaults, then what was saved, and audits the change", async () => {
    const defaults = await crm().getSettings();
    expect(defaults.followUps).toEqual({ j7: true, j15: true, j30: false });
    const saved = await crm().saveSettings({ ...defaults, vatPercent: 0, cabinetName: "Cabinet X" }, actorId);
    expect(saved.vatPercent).toBe(0);
    expect(await crm().getSettings()).toMatchObject({ vatPercent: 0, cabinetName: "Cabinet X" });
    expect(await db().auditLog.count({ where: { action: "settings.updated" } })).toBe(1);
  });

  it("falls back to defaults when the stored value is corrupt", async () => {
    await db().setting.create({ data: { key: "cabinet", value: { vatPercent: "not a number" } } });
    expect((await crm().getSettings()).vatPercent).toBe(18);
  });
});
