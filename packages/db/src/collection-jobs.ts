import {
  type ReminderRules,
  dayOffset,
  dueDate,
  dueReminder,
  endedPeriods,
  getTemplate,
  isLate,
  parseReminderRules,
  reminderKind,
} from "@manga/core/collection";
import type { PrismaClient } from "./generated/client";
import type { JobQueue } from "./queue";

/** Réglage des relances, éditable dans l'admin (clé de la table `Setting`). */
export const REMINDER_RULES_KEY = "collection.reminders";

const fr = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", ...options });
const monthFormat = fr({ month: "long", year: "numeric" });
const dayFormat = fr({ day: "2-digit", month: "2-digit", year: "numeric" });

/** « octobre 2026 » pour une période mensuelle, « semaine du 16/11/2026 » pour une période hebdomadaire. */
export function periodLabelOf(periodStart: Date, periodEnd: Date): string {
  const days = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1;
  return days > 8 ? monthFormat.format(periodStart) : `semaine du ${dayFormat.format(periodStart)}`;
}

export async function loadReminderRules(prisma: PrismaClient): Promise<ReminderRules> {
  const row = await prisma.setting.findUnique({ where: { key: REMINDER_RULES_KEY } });
  return parseReminderRules(row?.value);
}

/**
 * `collection.open-periods` (05:00 quotidien) : crée les périodes attendues pour les plans actifs,
 * à la fin de chaque période. Idempotent (clé unique plan + début de période). Retourne le nombre créé.
 */
export async function openPeriods(prisma: PrismaClient, today: Date): Promise<number> {
  const plans = await prisma.collectionPlan.findMany({
    where: { active: true, entity: { active: true } },
    select: { id: true, frequency: true, startsOn: true, delayDays: true },
  });
  let created = 0;
  for (const plan of plans) {
    const data = endedPeriods(plan.frequency, plan.startsOn, today).map((period) => {
      const dueAt = dueDate(period.end, plan.delayDays);
      return { planId: plan.id, periodStart: period.start, periodEnd: period.end, dueAt, status: isLate(dueAt, today) ? ("EN_RETARD" as const) : ("ATTENDU" as const) };
    });
    if (data.length === 0) continue;
    const result = await prisma.collectionPeriod.createMany({ data, skipDuplicates: true });
    created += result.count;
  }
  return created;
}

/** `collection.mark-late` (06:00 quotidien) : une période attendue dont l'échéance est passée devient `EN_RETARD`. */
export async function markLatePeriods(prisma: PrismaClient, today: Date): Promise<number> {
  const { count } = await prisma.collectionPeriod.updateMany({ where: { status: "ATTENDU", dueAt: { lt: today } }, data: { status: "EN_RETARD" } });
  return count;
}

export type PeriodReminderOutcome =
  | { sent: true; kind: string; recipients: number }
  | { sent: false; reason: "NOT_FOUND" | "NOT_REMINDABLE" | "CAP_REACHED" | "NOT_DUE" | "NO_RECIPIENT" | "RACE" };

export interface SendPeriodReminderOptions {
  prisma: PrismaClient;
  queue: Pick<JobQueue, "enqueueEmail">;
  periodId: string;
  appUrl: string;
  today: Date;
  now: Date;
  rules: ReminderRules;
  /** `null` pour le job planifié. */
  actorId: string | null;
  /** Une relance manuelle ignore le calendrier, mais pas le plafond. */
  manual: boolean;
}

const REMINDABLE = ["ATTENDU", "EN_RETARD"] as const;

/**
 * Envoie la prochaine relance d'une période (avenant §6) : J-2, J+1, J+3 aux contributeurs de
 * l'entité (à défaut, à la direction), J+5 avec la direction en copie ; 4 au plus ; chacune
 * journalisée. Le compteur est réservé avant l'envoi : deux workers (ou un worker et un admin) ne
 * relancent jamais deux fois.
 */
export async function sendPeriodReminder(options: SendPeriodReminderOptions): Promise<PeriodReminderOutcome> {
  const { prisma, queue, periodId, appUrl, today, now, rules, actorId, manual } = options;

  const period = await prisma.collectionPeriod.findUnique({
    where: { id: periodId },
    select: {
      id: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      dueAt: true,
      remindersSent: true,
      lastReminderAt: true,
      plan: { select: { id: true, active: true, templateId: true, entity: { select: { id: true, name: true, clientId: true, active: true } } } },
    },
  });
  if (!period) return { sent: false, reason: "NOT_FOUND" };
  if (!(REMINDABLE as readonly string[]).includes(period.status) || !period.plan.active || !period.plan.entity.active) return { sent: false, reason: "NOT_REMINDABLE" };
  if (period.remindersSent >= rules.cap) return { sent: false, reason: "CAP_REACHED" };

  const offset = dayOffset(period.dueAt, today);
  let kind = reminderKind(offset);
  let escalation = offset >= rules.escalationDay;
  if (!manual) {
    const history = await prisma.auditLog.findMany({ where: { action: "collection.reminder", entityId: period.id }, select: { diff: true } });
    const sent = history.map((row) => (row.diff as { kind?: string } | null)?.kind).filter((k): k is string => typeof k === "string");
    const step = dueReminder(rules, offset, sent);
    if (!step) return { sent: false, reason: "NOT_DUE" };
    kind = step.kind;
    escalation = step.escalation;
  }

  // Contributors of the entity; the direction when nobody is assigned, and in copy on escalation.
  const clientId = period.plan.entity.clientId;
  const contributors = await prisma.user.findMany({
    where: { disabledAt: null, role: "CLIENT_CONTRIBUTEUR", clientId, assignments: { some: { entityId: period.plan.entity.id } } },
    select: { id: true, name: true, email: true },
  });
  const direction = contributors.length === 0 || escalation ? await prisma.user.findMany({ where: { disabledAt: null, role: "CLIENT_DIRECTION", clientId }, select: { id: true, name: true, email: true } }) : [];
  const recipients = [...new Map([...contributors, ...direction].map((u) => [u.id, u])).values()];
  if (recipients.length === 0) return { sent: false, reason: "NO_RECIPIENT" };

  const claimed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.collectionPeriod.updateMany({
      where: { id: period.id, remindersSent: period.remindersSent, status: period.status },
      data: { remindersSent: { increment: 1 }, lastReminderAt: now },
    });
    if (count !== 1) return null;
    const audit = await tx.auditLog.create({
      data: { actorId, action: "collection.reminder", entity: "CollectionPeriod", entityId: period.id, diff: { kind: manual ? "MANUELLE" : kind, manual, escalation, recipients: recipients.length } },
      select: { id: true },
    });
    return audit.id;
  });
  if (!claimed) return { sent: false, reason: "RACE" };

  const template = getTemplate(period.plan.templateId);
  try {
    for (const user of recipients) {
      await queue.enqueueEmail(
        {
          template: "collection-reminder",
          to: user.email,
          data: {
            name: user.name,
            entityName: period.plan.entity.name,
            templateLabel: template?.label ?? period.plan.templateId,
            periodLabel: periodLabelOf(period.periodStart, period.periodEnd),
            dueAt: period.dueAt.toISOString(),
            offset,
            escalation,
            url: `${appUrl.replace(/\/$/, "")}/espace-client/collecte`,
          },
        },
        { dedupeKey: `collection-reminder:${period.id}:${manual ? `manual-${period.remindersSent + 1}` : kind}:${user.id}` },
      );
    }
  } catch (error) {
    // Nothing reached the queue: give the reminder back so the next run retries it.
    await prisma.collectionPeriod.updateMany({ where: { id: period.id, remindersSent: period.remindersSent + 1 }, data: { remindersSent: period.remindersSent, lastReminderAt: period.lastReminderAt } });
    await prisma.auditLog.delete({ where: { id: claimed } });
    throw error;
  }
  return { sent: true, kind: manual ? "MANUELLE" : kind, recipients: recipients.length };
}

/** Périodes dont une relance peut être due aujourd'hui : le job vérifie chacune précisément. */
export async function findPeriodReminderCandidates(prisma: PrismaClient, today: Date, rules: ReminderRules): Promise<string[]> {
  const rows = await prisma.collectionPeriod.findMany({
    where: {
      status: { in: [...REMINDABLE] },
      remindersSent: { lt: rules.cap },
      plan: { active: true, entity: { active: true } },
      // From the advance reminder to a little after the last step (older periods are never reminded).
      dueAt: { gte: new Date(today.getTime() - 14 * 86_400_000), lte: new Date(today.getTime() + (rules.beforeDue + 1) * 86_400_000) },
    },
    select: { id: true },
    orderBy: { dueAt: "asc" },
  });
  return rows.map((row) => row.id);
}

export interface WeeklyDigest {
  /** Lundi de la semaine récapitulée. */
  weekOf: Date;
  expected: number;
  received: number;
  late: { client: string; entity: string; period: string; daysLate: number }[];
  rejected: { client: string; entity: string; period: string }[];
}

/**
 * Récapitulatif hebdomadaire du consultant : complétude des échéances de la semaine écoulée, et tout
 * ce qui est en retard ou rejeté à ce jour.
 */
export async function buildWeeklyDigest(prisma: PrismaClient, today: Date): Promise<WeeklyDigest> {
  const weekStart = new Date(today.getTime() - 7 * 86_400_000);
  const base = { plan: { active: true, entity: { active: true } } };
  const include = { plan: { select: { entity: { select: { name: true, client: { select: { legalName: true } } } } } } } as const;

  const dueThisWeek = await prisma.collectionPeriod.findMany({ where: { ...base, dueAt: { gte: weekStart, lt: today } }, select: { status: true } });
  const received = dueThisWeek.filter((p) => ["EN_CONTROLE", "VALIDE", "ACCEPTE_AVEC_RESERVE"].includes(p.status)).length;

  const [late, rejected] = await Promise.all([
    prisma.collectionPeriod.findMany({ where: { ...base, status: "EN_RETARD" }, include, orderBy: { dueAt: "asc" } }),
    prisma.collectionPeriod.findMany({ where: { ...base, status: "REJETE" }, include, orderBy: { dueAt: "asc" } }),
  ]);
  return {
    weekOf: weekStart,
    expected: dueThisWeek.length,
    received,
    late: late.slice(0, 100).map((p) => ({ client: p.plan.entity.client.legalName, entity: p.plan.entity.name, period: periodLabelOf(p.periodStart, p.periodEnd), daysLate: Math.max(0, dayOffset(p.dueAt, today)) })),
    rejected: rejected.slice(0, 100).map((p) => ({ client: p.plan.entity.client.legalName, entity: p.plan.entity.name, period: periodLabelOf(p.periodStart, p.periodEnd) })),
  };
}
