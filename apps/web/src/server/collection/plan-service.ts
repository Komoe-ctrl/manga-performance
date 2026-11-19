import { getTemplate, parseReminderRules, type CollectionFrequency, type ReminderRules } from "@manga/core/collection";
import { REMINDER_RULES_KEY } from "@manga/db/collection-jobs";
import type { PrismaClient } from "@manga/db";
import { DomainError } from "../domain-error";
import { recordAudit } from "../repositories/audit";

export interface PlanInput {
  entityId: string;
  templateId: string;
  frequency: CollectionFrequency;
  /** Délai de dépôt après la fin de la période, en jours (J+3 par défaut). */
  delayDays: number;
  /** Premier jour de la première période attendue (`AAAA-MM-JJ`). */
  startsOn: string;
}

export interface PlanView {
  id: string;
  entityId: string;
  templateId: string;
  frequency: CollectionFrequency;
  delayDays: number;
  startsOn: string;
  active: boolean;
}

const select = { id: true, entityId: true, templateId: true, frequency: true, delayDays: true, startsOn: true, active: true } as const;
const view = (p: { id: string; entityId: string; templateId: string; frequency: CollectionFrequency; delayDays: number; startsOn: Date; active: boolean }): PlanView => ({ ...p, startsOn: p.startsOn.toISOString() });

/** Plans de collecte (entité × modèle) et règles de relance : administration, appelées derrière `requireAdmin`. */
export function createPlanService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  return {
    async createPlan(input: PlanInput, actorId: string): Promise<PlanView> {
      const template = getTemplate(input.templateId);
      if (!template) throw new DomainError("VALIDATION", "Modèle de collecte inconnu.");
      if (!["MENSUELLE", "HEBDOMADAIRE"].includes(input.frequency)) throw new DomainError("VALIDATION", "Fréquence inconnue.");
      if (!Number.isInteger(input.delayDays) || input.delayDays < 0 || input.delayDays > 30) throw new DomainError("VALIDATION", "Le délai doit être compris entre 0 et 30 jours.");
      const startsOn = /^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) ? new Date(`${input.startsOn}T00:00:00Z`) : null;
      if (!startsOn || Number.isNaN(startsOn.getTime()) || startsOn.toISOString().slice(0, 10) !== input.startsOn) throw new DomainError("VALIDATION", "Date de début invalide (AAAA-MM-JJ).");

      const entity = await prisma.entity.findUnique({ where: { id: input.entityId }, select: { id: true, sector: true } });
      if (!entity) throw new DomainError("NOT_FOUND", "Entité introuvable.");
      if (template.sector !== entity.sector) throw new DomainError("VALIDATION", "Ce modèle ne correspond pas au secteur de l'entité.");
      if (await prisma.collectionPlan.findUnique({ where: { entityId_templateId: { entityId: entity.id, templateId: template.id } }, select: { id: true } })) {
        throw new DomainError("DUPLICATE", "Cette entité a déjà un plan pour ce modèle.");
      }

      return prisma.$transaction(async (tx) => {
        const plan = await tx.collectionPlan.create({ data: { entityId: entity.id, templateId: template.id, frequency: input.frequency, delayDays: input.delayDays, startsOn }, select });
        await recordAudit(tx, { actorId, action: "plan.create", entity: "CollectionPlan", entityId: plan.id, diff: { entityId: entity.id, templateId: template.id, frequency: input.frequency, delayDays: input.delayDays, startsOn: input.startsOn } });
        return view(plan);
      });
    },

    /** Suspend ou reprend un plan : une période déjà ouverte reste, aucune nouvelle n'est créée ni relancée. */
    async setPlanActive(planId: string, active: boolean, actorId: string): Promise<PlanView> {
      const existing = await prisma.collectionPlan.findUnique({ where: { id: planId }, select: { id: true } });
      if (!existing) throw new DomainError("NOT_FOUND", "Plan introuvable.");
      return prisma.$transaction(async (tx) => {
        const plan = await tx.collectionPlan.update({ where: { id: planId }, data: { active }, select });
        await recordAudit(tx, { actorId, action: active ? "plan.resume" : "plan.suspend", entity: "CollectionPlan", entityId: planId, diff: { active } });
        return view(plan);
      });
    },

    async getReminderRules(): Promise<ReminderRules> {
      const row = await prisma.setting.findUnique({ where: { key: REMINDER_RULES_KEY } });
      return parseReminderRules(row?.value);
    },

    /** Les valeurs hors bornes sont refusées (et non corrigées en silence) ; la lecture, elle, retombe sur les défauts. */
    async saveReminderRules(rules: ReminderRules, actorId: string): Promise<ReminderRules> {
      const bad = (message: string) => new DomainError("VALIDATION", message);
      if (!Number.isInteger(rules.cap) || rules.cap < 1 || rules.cap > 10) throw bad("Le plafond doit être compris entre 1 et 10.");
      if (!Number.isInteger(rules.beforeDue) || rules.beforeDue < 0 || rules.beforeDue > 30) throw bad("Le rappel avant échéance doit être compris entre 0 et 30 jours.");
      if (!Array.isArray(rules.afterDue) || rules.afterDue.length > 6 || rules.afterDue.some((n) => !Number.isInteger(n) || n < 1 || n > 60)) throw bad("Les relances après échéance doivent être 6 jours au plus, entre 1 et 60.");
      if (!Number.isInteger(rules.escalationDay) || rules.escalationDay < 1 || rules.escalationDay > 60) throw bad("Le jour d'escalade doit être compris entre 1 et 60.");
      if (!Number.isInteger(rules.sendHour) || rules.sendHour < 0 || rules.sendHour > 23) throw bad("L'heure d'envoi doit être comprise entre 0 et 23.");
      const clean = parseReminderRules(rules);
      await prisma.$transaction(async (tx) => {
        await tx.setting.upsert({ where: { key: REMINDER_RULES_KEY }, create: { key: REMINDER_RULES_KEY, value: clean as unknown as object }, update: { value: clean as unknown as object } });
        await recordAudit(tx, { actorId, action: "collection.reminder_rules", entity: "Setting", entityId: REMINDER_RULES_KEY, diff: { ...clean } });
      });
      return clean;
    },
  };
}

export type PlanService = ReturnType<typeof createPlanService>;
