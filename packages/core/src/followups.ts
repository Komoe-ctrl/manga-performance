export type FollowUpRule = "J+7" | "J+15" | "J+30" | "MANUEL";

export interface FollowUpRulesSetting {
  j7: boolean;
  j15: boolean;
  j30: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const SCHEDULE: { rule: Exclude<FollowUpRule, "MANUEL">; days: number; key: keyof FollowUpRulesSetting }[] = [
  { rule: "J+7", days: 7, key: "j7" },
  { rule: "J+15", days: 15, key: "j15" },
  { rule: "J+30", days: 30, key: "j30" },
];

/** Follow-ups generated when a prospect is created, per the rules enabled in the settings. */
export function planFollowUps(
  createdAt: Date,
  rules: FollowUpRulesSetting,
): { rule: Exclude<FollowUpRule, "MANUEL">; dueAt: Date }[] {
  return SCHEDULE.filter((step) => rules[step.key]).map((step) => ({
    rule: step.rule,
    dueAt: new Date(createdAt.getTime() + step.days * DAY_MS),
  }));
}

export type ProspectStatusValue = "NOUVEAU" | "EN_NEGOCIATION" | "CLIENT" | "PERDU";

/** Becoming a client or being lost closes the prospect: pending follow-ups are cancelled. */
export function closesProspect(status: ProspectStatusValue): boolean {
  return status === "CLIENT" || status === "PERDU";
}

export type FollowUpBucket = "OVERDUE" | "TODAY" | "UPCOMING";

/** Digest bucket (spec, 6.2) for a pending follow-up, in the given IANA timezone. */
export function bucketFollowUp(dueAt: Date, now: Date, timeZone = "Africa/Abidjan"): FollowUpBucket {
  const day = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const due = day(dueAt);
  const today = day(now);
  if (due < today) return "OVERDUE";
  return due === today ? "TODAY" : "UPCOMING";
}
