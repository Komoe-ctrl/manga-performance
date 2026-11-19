import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sendPeriodReminder } from "@manga/db/collection-jobs";
import { runMarkLate, runOpenPeriods, runReminders, runWeeklyDigest } from "../src/jobs/collection";
import { db, makeDeps, resetDatabase, shutdown } from "./helpers";

/** Business time: the cabinet is on Africa/Abidjan (UTC+0, no daylight saving). */
const at = (iso: string, hour = 8) => new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00Z`);

async function seed(options: { startsOn?: string; frequency?: "MENSUELLE" | "HEBDOMADAIRE"; contributors?: number; direction?: boolean } = {}) {
  const prospect = await db().prospect.create({ data: { companyName: "Groupe Lagune", companyNameNorm: "groupe lagune", sector: "Hôtellerie", source: "MANUEL", status: "CLIENT" } });
  const client = await db().client.create({ data: { prospectId: prospect.id, legalName: "Groupe Lagune" } });
  const entity = await db().entity.create({ data: { clientId: client.id, name: "Hôtel Lagune", sector: "HOTELLERIE" } });
  const plan = await db().collectionPlan.create({
    data: { entityId: entity.id, templateId: "hotel_mensuel", startsOn: new Date(`${options.startsOn ?? "2026-10-01"}T00:00:00Z`), frequency: options.frequency ?? "MENSUELLE", delayDays: 3 },
  });
  const users = async (role: "CLIENT_CONTRIBUTEUR" | "CLIENT_DIRECTION", n: number, assign: boolean) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const user = await db().user.create({ data: { email: `${role.toLowerCase()}-${i}@lagune.ci`, name: `${role} ${i}`, role, clientId: client.id } });
      if (assign) await db().entityAssignment.create({ data: { userId: user.id, entityId: entity.id } });
      out.push(user);
    }
    return out;
  };
  const contributors = await users("CLIENT_CONTRIBUTEUR", options.contributors ?? 1, true);
  const direction = options.direction === false ? [] : await users("CLIENT_DIRECTION", 1, false);
  return { client, entity, plan, contributors, direction };
}

/** One business day: open periods (05:00), mark late (06:00), then the reminders (08:00). */
async function runDay(iso: string, queue = makeDeps().queue) {
  const results = { open: 0, late: 0, reminders: { sent: 0, skipped: 0, failed: 0 } };
  const run = <T>(hour: number, job: (deps: ReturnType<typeof makeDeps>["deps"]) => Promise<T>) => job(makeDeps({ now: () => at(iso, hour), queue }).deps);
  results.open = (await run(5, runOpenPeriods)).created;
  results.late = (await run(6, runMarkLate)).marked;
  results.reminders = await run(8, runReminders);
  return results;
}

beforeEach(resetDatabase);
afterAll(shutdown);

describe("collection.open-periods", () => {
  it("opens the period that has just ended, once, with its due date", async () => {
    const { plan } = await seed();
    expect((await runOpenPeriods(makeDeps({ now: () => at("2026-10-31", 5) }).deps)).created).toBe(0); // October is not over yet
    expect((await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps)).created).toBe(1);
    expect((await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps)).created).toBe(0); // idempotent
    const period = await db().collectionPeriod.findFirstOrThrow({ where: { planId: plan.id } });
    expect(period).toMatchObject({ status: "ATTENDU", remindersSent: 0 });
    expect(period.periodStart.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(period.periodEnd.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(period.dueAt.toISOString().slice(0, 10)).toBe("2026-11-03");
  });

  it("creates the following month at its end, keeping the previous one", async () => {
    await seed();
    await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps);
    await runOpenPeriods(makeDeps({ now: () => at("2026-12-01", 5) }).deps);
    expect(await db().collectionPeriod.count()).toBe(2);
  });

  it("backfills an old plan, with already-late periods marked as such", async () => {
    await seed({ startsOn: "2026-08-15" });
    expect((await runOpenPeriods(makeDeps({ now: () => at("2026-11-10", 5) }).deps)).created).toBe(3);
    const periods = await db().collectionPeriod.findMany({ orderBy: { periodStart: "asc" } });
    expect(periods.map((p) => p.periodStart.toISOString().slice(0, 7))).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(periods.map((p) => p.status)).toEqual(["EN_RETARD", "EN_RETARD", "EN_RETARD"]);
  });

  it("opens weekly periods from Monday to Sunday", async () => {
    await seed({ startsOn: "2026-11-02", frequency: "HEBDOMADAIRE" });
    await runOpenPeriods(makeDeps({ now: () => at("2026-11-16", 5) }).deps);
    const periods = await db().collectionPeriod.findMany({ orderBy: { periodStart: "asc" } });
    expect(periods.map((p) => [p.periodStart.toISOString().slice(0, 10), p.periodEnd.toISOString().slice(0, 10)])).toEqual([
      ["2026-11-02", "2026-11-08"],
      ["2026-11-09", "2026-11-15"],
    ]);
  });

  it("ignores suspended plans and inactive entities", async () => {
    const { plan, entity } = await seed();
    await db().collectionPlan.update({ where: { id: plan.id }, data: { active: false } });
    expect((await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps)).created).toBe(0);
    await db().collectionPlan.update({ where: { id: plan.id }, data: { active: true } });
    await db().entity.update({ where: { id: entity.id }, data: { active: false } });
    expect((await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps)).created).toBe(0);
  });
});

describe("collection.mark-late", () => {
  it("turns an expected period late the day after its due date, never before", async () => {
    await seed();
    await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps);
    const status = async () => (await db().collectionPeriod.findFirstOrThrow()).status;
    await runMarkLate(makeDeps({ now: () => at("2026-11-03", 6) }).deps);
    expect(await status()).toBe("ATTENDU"); // the due day itself
    expect((await runMarkLate(makeDeps({ now: () => at("2026-11-04", 6) }).deps)).marked).toBe(1);
    expect(await status()).toBe("EN_RETARD");
    expect((await runMarkLate(makeDeps({ now: () => at("2026-11-05", 6) }).deps)).marked).toBe(0);
  });

  it("leaves validated, rejected and in-progress periods alone", async () => {
    const { plan } = await seed();
    for (const [i, status] of (["VALIDE", "REJETE", "EN_CONTROLE", "ACCEPTE_AVEC_RESERVE"] as const).entries()) {
      await db().collectionPeriod.create({ data: { planId: plan.id, periodStart: new Date(Date.UTC(2026, i, 1)), periodEnd: new Date(Date.UTC(2026, i, 28)), dueAt: new Date(Date.UTC(2026, i, 31)), status } });
    }
    expect((await runMarkLate(makeDeps({ now: () => at("2026-11-20", 6) }).deps)).marked).toBe(0);
  });
});

describe("a full month, day by day (simulated clock)", () => {
  it("sends J-2, J+1, J+3 to the contributor, J+5 with the direction in copy, then stops at the cap", async () => {
    const { contributors, direction } = await seed();
    const { queue } = makeDeps();
    const sentOn: Record<string, string[]> = {};
    for (let day = 1; day <= 12; day++) {
      const iso = `2026-11-${String(day).padStart(2, "0")}`;
      const before = queue.emails.length;
      await runDay(iso, queue);
      sentOn[iso] = queue.emails.slice(before).map((e) => e.job.to);
    }

    const period = await db().collectionPeriod.findFirstOrThrow();
    expect(period.status).toBe("EN_RETARD");
    expect(period.remindersSent).toBe(4);

    expect(sentOn["2026-11-01"]).toEqual([contributors[0]!.email]); // J-2 (due 3 Nov)
    expect(sentOn["2026-11-02"]).toEqual([]);
    expect(sentOn["2026-11-03"]).toEqual([]);
    expect(sentOn["2026-11-04"]).toEqual([contributors[0]!.email]); // J+1
    expect(sentOn["2026-11-05"]).toEqual([]);
    expect(sentOn["2026-11-06"]).toEqual([contributors[0]!.email]); // J+3
    expect(sentOn["2026-11-08"].sort()).toEqual([contributors[0]!.email, direction[0]!.email].sort()); // J+5, escalation
    for (const iso of ["2026-11-07", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]) expect(sentOn[iso]).toEqual([]);

    const reminders = queue.emails.filter((e) => e.job.template === "collection-reminder");
    expect(reminders).toHaveLength(5);
    const first = reminders[0]!.job;
    expect(first.template === "collection-reminder" && first.data).toMatchObject({ entityName: "Hôtel Lagune", periodLabel: "octobre 2026", offset: -2, escalation: false });
    const last = reminders[4]!.job;
    expect(last.template === "collection-reminder" && last.data).toMatchObject({ offset: 5, escalation: true });

    // Every reminder is logged and visible in the history.
    const audit = await db().auditLog.findMany({ where: { action: "collection.reminder", entityId: period.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => (a.diff as { kind: string }).kind)).toEqual(["J-2", "J+1", "J+3", "J+5"]);
  });

  it("does not remind again once the period is validated", async () => {
    await seed();
    const { queue } = makeDeps();
    await runDay("2026-11-01", queue);
    await db().collectionPeriod.updateMany({ data: { status: "VALIDE" } });
    for (const day of ["2026-11-04", "2026-11-06", "2026-11-08"]) await runDay(day, queue);
    expect(queue.emails).toHaveLength(1);
  });

  it("is idempotent within a day and acts only at the configured hour", async () => {
    await seed();
    const { queue } = makeDeps();
    await runDay("2026-11-01", queue);
    const again = await runReminders(makeDeps({ now: () => at("2026-11-01", 8), queue }).deps);
    expect(again.sent).toBe(0);
    expect(queue.emails).toHaveLength(1);

    await db().collectionPeriod.updateMany({ data: { remindersSent: 0 } });
    await db().auditLog.deleteMany({ where: { action: "collection.reminder" } });
    const wrongHour = await runReminders(makeDeps({ now: () => at("2026-11-01", 9), queue }).deps);
    expect(wrongHour).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(queue.emails).toHaveLength(1);
  });

  it("follows the rules set by the admin (hour, steps, cap)", async () => {
    await seed();
    await db().setting.create({ data: { key: "collection.reminders", value: { beforeDue: 0, afterDue: [2], escalationDay: 4, cap: 2, sendHour: 10 } } });
    const { queue } = makeDeps();
    await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps);
    for (const [iso, hour] of [["2026-11-01", 8], ["2026-11-01", 10], ["2026-11-05", 8], ["2026-11-05", 10], ["2026-11-07", 10], ["2026-11-09", 10]] as const) {
      await runReminders(makeDeps({ now: () => at(iso, hour), queue }).deps);
    }
    // J+2 on 5 Nov, J+4 on 7 Nov (escalation); the cap of 2 stops the rest.
    expect(queue.emails.filter((e) => e.job.template === "collection-reminder")).toHaveLength(3); // 1 + (contributor + direction)
    expect((await db().collectionPeriod.findFirstOrThrow()).remindersSent).toBe(2);
  });

  it("falls back to the direction when nobody is assigned, and stays silent when nobody can be reminded", async () => {
    const { contributors, direction } = await seed({ contributors: 0 });
    const { queue } = makeDeps();
    await runDay("2026-11-01", queue);
    expect(queue.emails.map((e) => e.job.to)).toEqual([direction[0]!.email]);
    expect(contributors).toHaveLength(0);

    await db().user.updateMany({ where: { role: "CLIENT_DIRECTION" }, data: { disabledAt: new Date() } });
    const before = queue.emails.length;
    const outcome = await runDay("2026-11-04", queue);
    expect(queue.emails).toHaveLength(before);
    expect(outcome.reminders.skipped).toBe(1);
    expect((await db().collectionPeriod.findFirstOrThrow()).remindersSent).toBe(1); // nothing was claimed
  });

  it("does not remind disabled contributors", async () => {
    const { contributors } = await seed({ contributors: 2 });
    await db().user.update({ where: { id: contributors[1]!.id }, data: { disabledAt: new Date() } });
    const { queue } = makeDeps();
    await runDay("2026-11-01", queue);
    expect(queue.emails.map((e) => e.job.to)).toEqual([contributors[0]!.email]);
  });

  it("never reminds on old periods when a plan is backfilled", async () => {
    await seed({ startsOn: "2026-06-01" });
    const { queue } = makeDeps();
    const outcome = await runDay("2026-11-20", queue);
    expect(outcome.open).toBe(5);
    expect(queue.emails).toHaveLength(0);
  });

  it("keeps the other periods going when one reminder fails, and gives the failed one back", async () => {
    await seed();
    const { queue } = makeDeps();
    const failing = Object.assign(Object.create(queue), { enqueueEmail: async () => { throw new Error("queue down"); } });
    const result = await runDay("2026-11-01", failing);
    expect(result.reminders.failed).toBe(1);
    const period = await db().collectionPeriod.findFirstOrThrow();
    expect(period.remindersSent).toBe(0);
    expect(await db().auditLog.count({ where: { action: "collection.reminder" } })).toBe(0);
    // The next run retries it.
    await runReminders(makeDeps({ now: () => at("2026-11-01", 8), queue }).deps);
    expect(queue.emails).toHaveLength(1);
  });
});

describe("manual reminders", () => {
  it("ignore the calendar but not the cap, and are logged as manual", async () => {
    const { contributors } = await seed();
    await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps);
    const period = await db().collectionPeriod.findFirstOrThrow();
    const { deps, queue } = makeDeps();
    const rules = { beforeDue: 2, afterDue: [1, 3], escalationDay: 5, cap: 2, sendHour: 8 };
    const call = () => sendPeriodReminder({ prisma: deps.prisma, queue, periodId: period.id, appUrl: "https://app.example.com", today: at("2026-11-02"), now: at("2026-11-02"), rules, actorId: null, manual: true });
    expect(await call()).toEqual({ sent: true, kind: "MANUELLE", recipients: 1 });
    expect(await call()).toEqual({ sent: true, kind: "MANUELLE", recipients: 1 });
    expect(await call()).toEqual({ sent: false, reason: "CAP_REACHED" });
    expect(queue.emails.map((e) => e.job.to)).toEqual([contributors[0]!.email, contributors[0]!.email]);
    expect(queue.emails.map((e) => e.dedupeKey)).toHaveLength(2);
    expect(new Set(queue.emails.map((e) => e.dedupeKey)).size).toBe(2);
    const audit = await db().auditLog.findMany({ where: { action: "collection.reminder" } });
    expect(audit.map((a) => (a.diff as { manual: boolean }).manual)).toEqual([true, true]);
  });

  it("refuses a missing period, a validated one and a suspended plan", async () => {
    const { plan } = await seed();
    await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps);
    const period = await db().collectionPeriod.findFirstOrThrow();
    const { deps, queue } = makeDeps();
    const rules = { beforeDue: 2, afterDue: [1, 3], escalationDay: 5, cap: 4, sendHour: 8 };
    const call = (periodId: string) => sendPeriodReminder({ prisma: deps.prisma, queue, periodId, appUrl: "https://a.example", today: at("2026-11-02"), now: at("2026-11-02"), rules, actorId: "admin-1", manual: true });
    expect(await call("nope")).toEqual({ sent: false, reason: "NOT_FOUND" });
    await db().collectionPlan.update({ where: { id: plan.id }, data: { active: false } });
    expect(await call(period.id)).toEqual({ sent: false, reason: "NOT_REMINDABLE" });
    await db().collectionPlan.update({ where: { id: plan.id }, data: { active: true } });
    await db().collectionPeriod.update({ where: { id: period.id }, data: { status: "VALIDE" } });
    expect(await call(period.id)).toEqual({ sent: false, reason: "NOT_REMINDABLE" });
  });
});

describe("collection.weekly-digest", () => {
  it("reports the week's completeness, what is late and what is rejected, once per week", async () => {
    const { entity } = await seed();
    const second = await db().entity.create({ data: { clientId: entity.clientId, name: "Hôtel Baobab", sector: "HOTELLERIE" } });
    const plan2 = await db().collectionPlan.create({ data: { entityId: second.id, templateId: "hotel_mensuel", startsOn: at("2026-10-01") } });
    await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps);
    // Entity 1 deposited and was validated; entity 2 is late.
    await db().collectionPeriod.updateMany({ where: { plan: { entityId: entity.id } }, data: { status: "VALIDE" } });
    await runMarkLate(makeDeps({ now: () => at("2026-11-05", 6) }).deps);
    expect(plan2.id).toBeTruthy();

    const { deps, queue } = makeDeps({ now: () => at("2026-11-09", 7) });
    expect(await runWeeklyDigest(deps)).toEqual({ sent: true });
    const fanout = queue.fanouts[0]!;
    expect(fanout.dedupeKey).toBe("collection-weekly:2026-11-02");
    expect(fanout.job.type).toBe("COLLECTION_WEEKLY_DIGEST");
    const email = fanout.job.email!;
    expect(email.template).toBe("collection-weekly-digest");
    if (email.template !== "collection-weekly-digest") return;
    expect(email.data).toMatchObject({ weekOf: "2026-11-02", expected: 2, received: 1 });
    expect(email.data.late).toEqual([{ client: "Groupe Lagune", entity: "Hôtel Baobab", period: "octobre 2026", daysLate: 6 }]);
    expect(email.data.rejected).toEqual([]);
  });

  it("lists rejected periods too, and sends nothing on a quiet week", async () => {
    const { deps: quietDeps, queue: quietQueue } = makeDeps({ now: () => at("2026-11-09", 7) });
    expect(await runWeeklyDigest(quietDeps)).toEqual({ sent: false });
    expect(quietQueue.fanouts).toHaveLength(0);

    await seed();
    await runOpenPeriods(makeDeps({ now: () => at("2026-11-01", 5) }).deps);
    await db().collectionPeriod.updateMany({ data: { status: "REJETE" } });
    const { deps, queue } = makeDeps({ now: () => at("2026-11-09", 7) });
    await runWeeklyDigest(deps);
    const email = queue.fanouts[0]!.job.email!;
    expect(email.template === "collection-weekly-digest" && email.data.rejected).toEqual([{ client: "Groupe Lagune", entity: "Hôtel Lagune", period: "octobre 2026" }]);
  });
});
