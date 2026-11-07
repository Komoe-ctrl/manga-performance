/** Sending guard-rails for email sequences (spec, 6.7). */

export const SEND_WINDOW = { startHour: 8, endHour: 18 } as const;
export const DEFAULT_DAILY_CAP = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    day: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Monday to Friday, 08:00 (included) to 18:00 (excluded), in the display timezone. */
export function isInSendWindow(now: Date, timeZone = "Africa/Abidjan"): boolean {
  const { weekday, hour } = localParts(now, timeZone);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour;
}

/** Start of the local day containing `now`, as an instant (daylight-saving transitions aside). */
export function startOfLocalDay(now: Date, timeZone = "Africa/Abidjan"): Date {
  const { hour, minute, second } = localParts(now, timeZone);
  return new Date(Math.floor(now.getTime() / 1000) * 1000 - ((hour * 60 + minute) * 60 + second) * 1000);
}

/** When the step after the one just sent is due. */
export function nextSendAt(sentAt: Date, delayDays: number): Date {
  return new Date(sentAt.getTime() + delayDays * DAY_MS);
}

export interface SequenceStepShape {
  order: number;
  delayDays: number;
}

/** What to do after sending step `index` (0-based): the due date of the next one, or completion. */
export function afterSend(steps: SequenceStepShape[], index: number, sentAt: Date): { status: "ACTIVE" | "COMPLETED"; currentStep: number; nextSendAt: Date | null } {
  const next = steps[index + 1];
  return next
    ? { status: "ACTIVE", currentStep: index + 1, nextSendAt: nextSendAt(sentAt, next.delayDays) }
    : { status: "COMPLETED", currentStep: index + 1, nextSendAt: null };
}
