/**
 * Calendrier de collecte (avenant n°1, §6) : périodes, échéances, retards et règles de relance.
 * Fonctions pures. Les jours sont des jours calendaires, représentés par des dates UTC à minuit :
 * le fuseau du cabinet intervient une seule fois, dans `localDay`.
 */

export type CollectionFrequency = "MENSUELLE" | "HEBDOMADAIRE";

const DAY_MS = 86_400_000;
const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** Jour calendaire (UTC à minuit) de `now` dans le fuseau d'affichage du cabinet. */
export function localDay(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  return utcDay(parts[0]!, parts[1]! - 1, parts[2]!);
}

export interface CalendarPeriod {
  start: Date;
  /** Dernier jour de la période, inclus. */
  end: Date;
}

/** Période (mois civil, ou semaine du lundi au dimanche) qui contient `day`. */
export function periodContaining(frequency: CollectionFrequency, day: Date): CalendarPeriod {
  if (frequency === "MENSUELLE") {
    return { start: utcDay(day.getUTCFullYear(), day.getUTCMonth(), 1), end: utcDay(day.getUTCFullYear(), day.getUTCMonth() + 1, 0) };
  }
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  const start = addDays(utcDay(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()), -sinceMonday);
  return { start, end: addDays(start, 6) };
}

/**
 * Périodes d'un plan **terminées** avant `today`, de celle qui contient `startsOn` à la dernière
 * terminée. Une période n'est attendue qu'à sa fin. `limit` borne le rattrapage d'un vieux plan.
 */
export function endedPeriods(frequency: CollectionFrequency, startsOn: Date, today: Date, limit = 36): CalendarPeriod[] {
  const periods: CalendarPeriod[] = [];
  let current = periodContaining(frequency, startsOn);
  while (current.end < today) {
    periods.push(current);
    current = periodContaining(frequency, addDays(current.end, 1));
  }
  return periods.slice(-limit);
}

/** Échéance : `delayDays` jours après la fin de la période (le jour de l'échéance inclus). */
export const dueDate = (periodEnd: Date, delayDays: number): Date => addDays(periodEnd, delayDays);

/** Écart en jours entre aujourd'hui et le jour de l'échéance : négatif avant, 0 le jour même, positif après. */
export function dayOffset(dueAt: Date, today: Date): number {
  const due = utcDay(dueAt.getUTCFullYear(), dueAt.getUTCMonth(), dueAt.getUTCDate());
  return Math.round((today.getTime() - due.getTime()) / DAY_MS);
}

/** En retard dès le lendemain du jour d'échéance. */
export const isLate = (dueAt: Date, today: Date): boolean => dayOffset(dueAt, today) > 0;

/* ---------- Relances ---------- */

/** Règles de relance, paramétrables dans l'admin (valeurs par défaut de l'avenant §6). */
export interface ReminderRules {
  /** Rappel `beforeDue` jours avant l'échéance (0 : désactivé). */
  beforeDue: number;
  /** Relances `n` jours après l'échéance. */
  afterDue: number[];
  /** À partir de ce jour après l'échéance, la direction du client est en copie. */
  escalationDay: number;
  /** Nombre maximal de relances par période. */
  cap: number;
  sendHour: number;
}

export const DEFAULT_REMINDER_RULES: ReminderRules = { beforeDue: 2, afterDue: [1, 3], escalationDay: 5, cap: 4, sendHour: 8 };

const int = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;

/** Lit des règles stockées : tout ce qui est absent ou invalide retombe sur la valeur par défaut. */
export function parseReminderRules(raw: unknown): ReminderRules {
  const d = DEFAULT_REMINDER_RULES;
  if (typeof raw !== "object" || raw === null) return { ...d, afterDue: [...d.afterDue] };
  const r = raw as Record<string, unknown>;
  const afterDue = Array.isArray(r.afterDue) ? [...new Set(r.afterDue.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 60))].sort((a, b) => a - b) : null;
  return {
    beforeDue: int(r.beforeDue, d.beforeDue, 0, 30),
    afterDue: afterDue ?? [...d.afterDue],
    escalationDay: int(r.escalationDay, d.escalationDay, 1, 60),
    cap: int(r.cap, d.cap, 1, 20),
    sendHour: int(r.sendHour, d.sendHour, 0, 23),
  };
}

export interface ReminderStep {
  /** Écart à l'échéance : -2, 1, 3, 5… */
  offset: number;
  /** « J-2 », « J+1 »… */
  kind: string;
  /** La direction du client est en copie. */
  escalation: boolean;
}

export const reminderKind = (offset: number): string => (offset < 0 ? `J${offset}` : `J+${offset}`);

/** Paliers de relance, dans l'ordre chronologique (l'escalade s'ajoute si elle n'est pas déjà un palier). */
export function reminderSteps(rules: ReminderRules): ReminderStep[] {
  const offsets = new Set<number>(rules.afterDue);
  if (rules.beforeDue > 0) offsets.add(-rules.beforeDue);
  offsets.add(rules.escalationDay);
  return [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => ({ offset, kind: reminderKind(offset), escalation: offset >= rules.escalationDay }));
}

/** Un palier manqué n'est rattrapé que dans les jours qui suivent : jamais de relance sur une vieille période. */
export const CATCH_UP_DAYS = 2;

/**
 * Relance à envoyer aujourd'hui, ou `null`. On retient le **dernier palier franchi** qui n'a pas
 * encore été envoyé : un jour manqué est rattrapé (`CATCH_UP_DAYS` au plus), et un seul message part
 * par exécution. Au plafond (`cap`), plus rien n'est envoyé.
 */
export function dueReminder(rules: ReminderRules, offset: number, alreadySent: readonly string[]): ReminderStep | null {
  if (alreadySent.length >= rules.cap) return null;
  const crossed = reminderSteps(rules).filter((step) => step.offset <= offset);
  const latest = crossed[crossed.length - 1];
  if (!latest || alreadySent.includes(latest.kind) || offset - latest.offset > CATCH_UP_DAYS) return null;
  return latest;
}
