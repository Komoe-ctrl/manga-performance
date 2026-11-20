"use server";

import { localDay } from "@manga/core/collection";
import { getEnv } from "@manga/core/env";
import { loadReminderRules, sendPeriodReminder } from "@manga/db/collection-jobs";
import { z } from "zod";
import type { AdminSession, ClientSession } from "../auth/guards";
import { getCollection } from "../collection/instance";
import type { CollectionActor } from "../collection/scope";
import { getAccountFlows } from "../auth/flows-instance";
import { DomainError } from "../domain-error";
import { getPrisma } from "../db";
import { recordAudit } from "../repositories/audit";
import { getEnqueuer } from "../queue";
import { parseInput, runAdmin, runAdminOrClient } from "./result";

/*
 * Module Collecte (avenant n°1). Le navigateur ne dit jamais « de quel client » ni « de quelle
 * entité » : la session décide, et tout passe par `entityScope`. Les actions d'administration passent
 * par `runAdmin` ; celles que les clients utilisent aussi, par `runAdminOrClient`.
 */

const id = z.string().min(1).max(64);
const SECTORS = ["BTP", "HOTELLERIE", "RESTAURATION", "COMMERCE", "TECH_FINTECH"] as const;

const actorOf = (session: AdminSession | ClientSession): CollectionActor => ({ userId: session.userId, role: session.role, clientId: session.clientId ?? null });

// ---- suivi (admin, et client dans son périmètre) --------------------------------------

export async function getCollectionOverviewAction() {
  return runAdminOrClient((session) => getCollection().read.overview(actorOf(session)));
}

export async function getPeriodDetailAction(periodId: unknown) {
  return runAdminOrClient((session) => getCollection().read.periodDetail(actorOf(session), parseInput(id, periodId)));
}

// ---- dépôt (contributeur, direction, ou admin pour le compte d'un client) ----------------

const uploadSchema = z.object({ periodId: id, filename: z.string().min(1).max(255), sizeBytes: z.number().int().min(1).max(100 * 1024 * 1024) });

/** Étape 1 : URL présignée. Le navigateur y envoie le fichier, puis confirme. */
export async function requestDepositUploadAction(input: unknown) {
  return runAdminOrClient((session) => {
    const data = parseInput(uploadSchema, input);
    return getCollection().submissions.requestUpload(actorOf(session), data.periodId, { filename: data.filename, sizeBytes: data.sizeBytes });
  });
}

const confirmSchema = z.object({ periodId: id, key: z.string().min(1).max(300), originalName: z.string().min(1).max(255) });

/** Étape 2 : crée la version, passe la période en contrôle et met le contrôle en file. */
export async function confirmDepositAction(input: unknown) {
  return runAdminOrClient((session) => {
    const data = parseInput(confirmSchema, input);
    return getCollection().submissions.confirmUpload(actorOf(session), data.periodId, { key: data.key, originalName: data.originalName });
  });
}

export async function downloadSubmissionAction(submissionId: unknown) {
  return runAdminOrClient((session) => getCollection().submissions.downloadOriginal(actorOf(session), parseInput(id, submissionId)));
}

// ---- administration --------------------------------------------------------------------

const forceSchema = z.object({ periodId: id, comment: z.string().max(1000) });

export async function forcePeriodAction(input: unknown) {
  return runAdmin(async (admin) => {
    const data = parseInput(forceSchema, input);
    await getCollection().submissions.forceAccept(admin.userId, data.periodId, data.comment);
    return { ok: true };
  });
}

/** Relance manuelle d'une ou plusieurs périodes ; retourne le nombre de relances envoyées (plafond respecté). */
export async function remindPeriodsAction(periodIds: unknown) {
  return runAdmin(async (admin) => {
    const ids = parseInput(z.array(id).min(1).max(200), periodIds);
    const env = getEnv();
    const prisma = getPrisma();
    const queue = await getEnqueuer();
    const rules = await loadReminderRules(prisma);
    const now = new Date();
    const today = localDay(now, env.TZ_DISPLAY);
    let sent = 0;
    for (const periodId of ids) {
      const outcome = await sendPeriodReminder({ prisma, queue, periodId, appUrl: env.APP_URL, today, now, rules, actorId: admin.userId, manual: true });
      if (outcome.sent) sent++;
    }
    return sent;
  });
}

export async function listCollectionEntitiesAction() {
  return runAdmin((admin) => getCollection().read.entitiesAndPlans(actorOf(admin)));
}

const entitySchema = z.object({ clientId: id, name: z.string().trim().min(2).max(120), sector: z.enum(SECTORS) });

export async function createCollectionEntityAction(input: unknown) {
  return runAdmin((admin) => getCollection().entities.createEntity(parseInput(entitySchema, input), admin.userId));
}

const planSchema = z.object({
  entityId: id,
  templateId: z.string().min(1).max(60),
  frequency: z.enum(["MENSUELLE", "HEBDOMADAIRE"]),
  delayDays: z.number().int().min(0).max(30),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function createCollectionPlanAction(input: unknown) {
  return runAdmin((admin) => getCollection().plans.createPlan(parseInput(planSchema, input), admin.userId));
}

export async function setCollectionPlanActiveAction(input: unknown) {
  return runAdmin((admin) => {
    const data = parseInput(z.object({ planId: id, active: z.boolean() }), input);
    return getCollection().plans.setPlanActive(data.planId, data.active, admin.userId);
  });
}

export async function listCollectionPeopleAction() {
  return runAdmin((admin) => getCollection().entities.listPeople(actorOf(admin)));
}

const assignSchema = z.object({ entityId: id, userId: id });

export async function assignContributorAction(input: unknown) {
  return runAdmin(async (admin) => {
    const data = parseInput(assignSchema, input);
    await getCollection().entities.assignContributor(data.entityId, data.userId, admin.userId);
    return { ok: true };
  });
}

export async function unassignContributorAction(input: unknown) {
  return runAdmin(async (admin) => {
    const data = parseInput(assignSchema, input);
    await getCollection().entities.unassignContributor(data.entityId, data.userId, admin.userId);
    return { ok: true };
  });
}

const inviteSchema = z.object({
  clientId: id,
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  role: z.enum(["CLIENT_DIRECTION", "CLIENT_CONTRIBUTEUR", "CLIENT_ANALYSTE"]),
});

const INVITE_ERRORS: Record<string, string> = {
  CLIENT_NOT_FOUND: "Client introuvable.",
  EMAIL_TAKEN: "Cette adresse email a déjà un compte.",
};

/** Crée le compte d'un client avec le rôle choisi et envoie l'invitation (lien valable 72 h). */
export async function inviteCollectionUserAction(input: unknown) {
  return runAdmin(async (admin) => {
    const data = parseInput(inviteSchema, input);
    const result = await getAccountFlows().inviteClientUser({ ...data, email: data.email.trim().toLowerCase() });
    if (!result.ok) throw new DomainError(result.code, INVITE_ERRORS[result.code] ?? "Invitation impossible.");
    await recordAudit(getPrisma(), { actorId: admin.userId, action: "client.access.invited", entity: "User", entityId: result.userId, diff: { clientId: data.clientId, role: data.role } });
    return { userId: result.userId };
  });
}

export async function getReminderRulesAction() {
  return runAdmin(() => getCollection().plans.getReminderRules());
}

const rulesSchema = z.object({
  beforeDue: z.number().int(),
  afterDue: z.array(z.number().int()).max(6),
  escalationDay: z.number().int(),
  cap: z.number().int(),
  sendHour: z.number().int(),
});

export async function saveReminderRulesAction(input: unknown) {
  return runAdmin((admin) => getCollection().plans.saveReminderRules(parseInput(rulesSchema, input), admin.userId));
}

// ---- pilote hôtellerie : paramètres CPRA et recalcul (admin) -----------------------------

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function getCpraParamsAction(input: unknown) {
  const { clientId } = parseInput(z.object({ clientId: id }), input);
  return runAdmin(() => getCollection().cpra.getParams(clientId));
}

export async function saveCpraProductAction(input: unknown) {
  const data = parseInput(z.object({ clientId: id, code: z.string().max(20), label: z.string().max(80), referenceUnit: z.enum(["unite", "ml"]), active: z.boolean().optional() }), input);
  return runAdmin((admin) => getCollection().cpra.saveProduct(data, admin.userId));
}

export async function setCpraConversionAction(input: unknown) {
  const data = parseInput(z.object({ productId: id, deliveryUnit: z.string().max(40), factor: z.number().nullable() }), input);
  return runAdmin((admin) => getCollection().cpra.setConversion(data, admin.userId));
}

export async function addCpraNormAction(input: unknown) {
  const data = parseInput(z.object({ productId: id, entityId: id.nullable(), validFrom: day, normPerClient: z.number(), nonUserRate: z.number(), unitCostFcfa: z.number() }), input);
  return runAdmin((admin) => getCollection().cpra.addNorm(data, admin.userId));
}

export async function setLongStayFactorAction(input: unknown) {
  const data = parseInput(z.object({ entityId: id, validFrom: day, factor: z.number() }), input);
  return runAdmin((admin) => getCollection().cpra.setLongStayFactor(data, admin.userId));
}

export async function saveCpraBoundsAction(input: unknown) {
  const data = parseInput(z.object({ clientId: id, strongUnder: z.number(), under: z.number(), overFrom: z.number(), strongOver: z.number() }), input);
  const { clientId, ...bounds } = data;
  return runAdmin((admin) => getCollection().cpra.saveBounds(clientId, bounds, admin.userId));
}

export async function recomputeCpraAction(input: unknown) {
  const data = parseInput(z.object({ periodId: id, note: z.string().max(200).default("") }), input);
  return runAdmin((admin) => getCollection().cpra.recompute(data.periodId, data.note, admin.userId));
}

export async function getCpraResultsAction(input: unknown) {
  const data = parseInput(z.object({ periodId: id, version: z.number().int().positive().optional() }), input);
  return runAdmin(() => getCollection().cpra.results(data.periodId, data.version));
}
