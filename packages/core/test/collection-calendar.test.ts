import { describe, expect, it } from "vitest";
import {
  CATCH_UP_DAYS,
  DEFAULT_REMINDER_RULES,
  dayOffset,
  dueDate,
  dueReminder,
  endedPeriods,
  isLate,
  localDay,
  parseReminderRules,
  periodContaining,
  reminderKind,
  reminderSteps,
} from "../src/collection/calendar";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe("periods", () => {
  it("finds the calendar month or the Monday-to-Sunday week containing a day", () => {
    expect(periodContaining("MENSUELLE", d(2026, 10, 17))).toEqual({ start: d(2026, 10, 1), end: d(2026, 10, 31) });
    expect(periodContaining("MENSUELLE", d(2028, 2, 10)).end).toEqual(d(2028, 2, 29));
    expect(periodContaining("HEBDOMADAIRE", d(2026, 11, 19))).toEqual({ start: d(2026, 11, 16), end: d(2026, 11, 22) }); // Thursday
    expect(periodContaining("HEBDOMADAIRE", d(2026, 11, 22)).start).toEqual(d(2026, 11, 16)); // Sunday
    expect(periodContaining("HEBDOMADAIRE", d(2026, 11, 16)).start).toEqual(d(2026, 11, 16)); // Monday
  });

  it("lists only the periods that are over, from the one containing the start date", () => {
    const monthly = endedPeriods("MENSUELLE", d(2026, 8, 15), d(2026, 11, 1));
    expect(monthly.map((p) => iso(p.start))).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    // The month in progress is not expected yet; the last day of a month is not over until the next day.
    expect(endedPeriods("MENSUELLE", d(2026, 10, 1), d(2026, 10, 31))).toEqual([]);
    expect(endedPeriods("MENSUELLE", d(2026, 10, 1), d(2026, 11, 1))).toHaveLength(1);
    const weekly = endedPeriods("HEBDOMADAIRE", d(2026, 11, 2), d(2026, 11, 17));
    expect(weekly.map((p) => iso(p.start))).toEqual(["2026-11-02", "2026-11-09"]);
    expect(endedPeriods("MENSUELLE", d(2027, 1, 1), d(2026, 11, 1))).toEqual([]);
  });

  it("bounds the catch-up of an old plan", () => {
    const many = endedPeriods("MENSUELLE", d(2020, 1, 1), d(2026, 11, 1), 12);
    expect(many).toHaveLength(12);
    expect(iso(many[11]!.start)).toBe("2026-10-01");
  });
});

describe("due dates", () => {
  it("adds the delay to the end of the period, across month ends", () => {
    expect(dueDate(d(2026, 10, 31), 3)).toEqual(d(2026, 11, 3));
    expect(dueDate(d(2026, 12, 31), 3)).toEqual(d(2027, 1, 3));
  });
  it("counts the offset to the due day, and is late from the day after", () => {
    const due = new Date("2026-11-03T00:00:00Z");
    expect(dayOffset(due, d(2026, 11, 1))).toBe(-2);
    expect(dayOffset(due, d(2026, 11, 3))).toBe(0);
    expect(dayOffset(due, d(2026, 11, 8))).toBe(5);
    expect(isLate(due, d(2026, 11, 3))).toBe(false);
    expect(isLate(due, d(2026, 11, 4))).toBe(true);
    // A due date stored with a time of day still counts as that day.
    expect(isLate(new Date("2026-11-03T22:30:00Z"), d(2026, 11, 3))).toBe(false);
  });
  it("takes the calendar day in the cabinet's time zone", () => {
    const night = new Date("2026-11-03T23:30:00Z");
    expect(localDay(night, "Africa/Abidjan")).toEqual(d(2026, 11, 3));
    expect(localDay(night, "Pacific/Auckland")).toEqual(d(2026, 11, 4));
  });
});

describe("reminder rules", () => {
  it("falls back to the default rules, field by field", () => {
    expect(parseReminderRules(undefined)).toEqual(DEFAULT_REMINDER_RULES);
    expect(parseReminderRules("nope")).toEqual(DEFAULT_REMINDER_RULES);
    expect(parseReminderRules({ beforeDue: "x", afterDue: "y", cap: 0, escalationDay: 99, sendHour: 30 })).toEqual(DEFAULT_REMINDER_RULES);
    expect(parseReminderRules({ beforeDue: 0, afterDue: [7, 2, 2, -1, 1.5, "3"], cap: 6, escalationDay: 7, sendHour: 9 })).toEqual({ beforeDue: 0, afterDue: [2, 7], escalationDay: 7, cap: 6, sendHour: 9 });
  });
  it("does not share the default array", () => {
    parseReminderRules(null).afterDue.push(99);
    expect(DEFAULT_REMINDER_RULES.afterDue).toEqual([1, 3]);
  });
  it("builds the steps of the avenant: J-2, J+1, J+3, J+5 (escalation)", () => {
    expect(reminderSteps(DEFAULT_REMINDER_RULES)).toEqual([
      { offset: -2, kind: "J-2", escalation: false },
      { offset: 1, kind: "J+1", escalation: false },
      { offset: 3, kind: "J+3", escalation: false },
      { offset: 5, kind: "J+5", escalation: true },
    ]);
    expect(reminderKind(0)).toBe("J+0");
  });
  it("drops the advance reminder when disabled, and merges an escalation that is already a step", () => {
    expect(reminderSteps({ ...DEFAULT_REMINDER_RULES, beforeDue: 0, afterDue: [3, 5], escalationDay: 5 }).map((s) => s.kind)).toEqual(["J+3", "J+5"]);
  });
});

describe("which reminder is due today", () => {
  const rules = DEFAULT_REMINDER_RULES;
  it("sends one reminder on each step day", () => {
    expect(dueReminder(rules, -2, [])?.kind).toBe("J-2");
    expect(dueReminder(rules, -3, [])).toBeNull();
    expect(dueReminder(rules, 1, ["J-2"])?.kind).toBe("J+1");
    expect(dueReminder(rules, 3, ["J-2", "J+1"])?.kind).toBe("J+3");
    expect(dueReminder(rules, 5, ["J+1"])).toMatchObject({ kind: "J+5", escalation: true });
  });
  it("is silent between steps and never sends the same step twice", () => {
    expect(dueReminder(rules, -1, ["J-2"])).toBeNull();
    expect(dueReminder(rules, 0, ["J-2"])).toBeNull();
    expect(dueReminder(rules, 1, ["J+1"])).toBeNull();
    expect(dueReminder(rules, 2, ["J-2", "J+1"])).toBeNull();
  });
  it("catches up a missed day, but only within a couple of days", () => {
    expect(dueReminder(rules, 2, ["J-2"])?.kind).toBe("J+1");
    expect(dueReminder(rules, 4, ["J-2", "J+1"])?.kind).toBe("J+3");
    const single = { ...rules, afterDue: [1], escalationDay: 30 };
    expect(dueReminder(single, 1 + CATCH_UP_DAYS, [])?.kind).toBe("J+1");
    expect(dueReminder(single, 1 + CATCH_UP_DAYS + 1, [])).toBeNull();
  });
  it("never reminds on an old period (first run after a long backfill)", () => {
    expect(dueReminder(rules, 120, [])).toBeNull();
    expect(dueReminder(rules, 8, ["J+3"])).toBeNull();
  });
  it("stops at the cap of reminders per period", () => {
    expect(dueReminder({ ...rules, cap: 2 }, 3, ["J-2", "J+1"])).toBeNull();
    expect(dueReminder({ ...rules, cap: 3 }, 3, ["J-2", "J+1"])?.kind).toBe("J+3");
  });
  it("sends the escalation one day late if the job missed it, and keeps the escalation flag", () => {
    expect(dueReminder(rules, 6, ["J+3"])).toMatchObject({ kind: "J+5", escalation: true });
  });
});
