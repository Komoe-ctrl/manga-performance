import { afterEach, describe, expect, it, vi } from "vitest";
import { dayOffset, trackingMonths } from "@manga/core/collection/calendar";

/**
 * Recette A4: the demonstration is built relative to today. Each case freezes the clock, rebuilds every fixture module
 * from scratch (they are computed when loaded) and checks the same invariants.
 */
const DAYS = ["2026-10-28", "2026-11-03", "2026-11-26", "2026-12-31", "2027-01-01", "2027-03-15"];
const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function at(iso: string) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T14:30:00.000Z`));
  const collection = await import("@/lib/mock/collection");
  const services = await import("@/lib/services/collection");
  const business = await import("@/lib/mock/business");
  const pilot = await import("@/lib/mock/pilot");
  return { collection, services, business, pilot, today: utcDay(iso) };
}

afterEach(() => vi.useRealTimers());

describe.each(DAYS)("with today = %s", (iso) => {
  it("shows the six last closed months then the current one, and only that", async () => {
    const { collection, today } = await at(iso);
    const expected = trackingMonths(today).map((m) => m.start.toISOString().slice(0, 7));
    expect(collection.collectionMonths.map((m) => m.key)).toEqual(expected);
    expect(expected.at(-1)).toBe(iso.slice(0, 7));
    const periodKeys = new Set(collection.buildCollectionPeriods().map((p) => p.periodStart.slice(0, 7)));
    expect([...periodKeys].sort()).toEqual(expected);
  });

  it("marks a month « à venir » only while it is not over, and a missed due date as late the next day", async () => {
    const { collection, today } = await at(iso);
    for (const p of collection.buildCollectionPeriods()) {
      const over = new Date(p.periodEnd).getTime() < today.getTime();
      expect(p.status === "A_VENIR", `${p.id}: ${p.status}`).toBe(!over);
      const late = dayOffset(new Date(p.dueAt), today) > 0;
      if (p.status === "EN_RETARD") expect(late, `${p.id} is flagged late before its due date`).toBe(true);
      if (p.status === "ATTENDU") expect(late, `${p.id} is still expected after its due date`).toBe(false);
    }
  });

  it("keeps every lifecycle status on screen, wherever today falls in the month", async () => {
    const { collection } = await at(iso);
    const statuses = new Set(collection.buildCollectionPeriods().map((p) => p.status));
    for (const s of ["VALIDE", "ACCEPTE_AVEC_RESERVE", "REJETE", "EN_CONTROLE", "EN_RETARD", "A_VENIR"]) expect(statuses.has(s as never), `${s} missing`).toBe(true);
  });

  it("counts late days from the real due date, with the server's function, and sends the reminders it should", async () => {
    const { collection, services, today } = await at(iso);
    for (const p of collection.buildCollectionPeriods().filter((x) => x.status === "EN_RETARD" || x.status === "REJETE")) {
      const days = dayOffset(new Date(p.dueAt), today);
      const label = services.dueLabel(p.dueAt);
      if (days > 0) expect(label).toEqual({ text: `${days} jour${days > 1 ? "s" : ""} de retard`, late: true });
      // J+1, J+3 and J+5 reminders exist once their day is reached, and never before.
      expect(p.reminders.map((r) => r.kind)).toEqual([1, 3, 5].filter((d) => days >= d).map((d) => `J+${d}`));
      for (const r of p.reminders) expect(new Date(r.at).getTime()).toBeLessThanOrEqual(today.getTime());
    }
  });

  it("gives the completeness of the last closed month, from today's calendar", async () => {
    const { collection, services } = await at(iso);
    const periods = collection.buildCollectionPeriods();
    const rows = collection.collectionPlans.map((plan) => ({ periods: periods.filter((p) => p.planId === plan.id) }));
    const result = services.monthCompleteness(rows, collection.collectionMonths);
    const previous = trackingMonths(utcDay(iso))[5]!.start.toISOString().slice(0, 7);
    expect(result?.key).toBe(previous);
    expect(result!.expected).toBe(collection.collectionPlans.length);
    expect(result!.complete).toBeGreaterThan(0);
    expect(result!.complete).toBeLessThan(result!.expected);
  });

  it("dates invoices, the pilot and the demo dashboard around today too", async () => {
    const { business, pilot, today } = await at(iso);
    const dayMs = 86_400_000;
    for (const inv of business.invoices) {
      const issued = new Date(inv.issuedAt).getTime();
      expect(issued).toBeLessThanOrEqual(today.getTime() + dayMs);
      expect(issued).toBeGreaterThan(today.getTime() - 201 * dayMs);
      const overdue = new Date(inv.dueAt).getTime() < today.getTime();
      if (inv.status === "en_retard") expect(overdue).toBe(true);
      if (inv.status === "en_attente" || inv.status === "emise") expect(overdue).toBe(false);
    }
    expect(pilot.PILOT_MONTHS.map((m) => m.key)).toEqual(trackingMonths(today).slice(0, 6).map((m) => m.start.toISOString().slice(0, 7)));
    expect(pilot.VALIDATED_UNTIL).toBe(pilot.PILOT_MONTHS[4]!.key);
    const demo = await import("@/lib/mock/demo-dashboard");
    expect(demo.DEMO_MONTHS).toHaveLength(24);
    expect(demo.DEMO_MONTHS.at(-1)).toBe(trackingMonths(today)[5]!.start.toISOString().slice(0, 7));
  });
});

describe("the late-days bug of the recette", () => {
  it("shows 54 days of late for a due date of 3 October seen on 26 November, not a frozen 24", async () => {
    const { services } = await at("2026-11-26");
    expect(services.dueLabel("2026-10-03T00:00:00.000Z")).toEqual({ text: "54 jours de retard", late: true });
    expect(services.dueLabel("2026-11-26T00:00:00.000Z")).toEqual({ text: "à rendre aujourd'hui", late: false });
    expect(services.dueLabel("2026-11-29T00:00:00.000Z")).toEqual({ text: "dans 3 jours", late: false });
  });

  it("no longer shows October as « à venir » in November", async () => {
    const { collection } = await at("2026-11-26");
    const october = collection.buildCollectionPeriods().filter((p) => p.periodStart.startsWith("2026-10"));
    expect(october.length).toBeGreaterThan(0);
    expect(october.every((p) => p.status !== "A_VENIR")).toBe(true);
    expect(collection.buildCollectionPeriods().filter((p) => p.periodStart.startsWith("2026-11")).every((p) => p.status === "A_VENIR")).toBe(true);
  });
});
