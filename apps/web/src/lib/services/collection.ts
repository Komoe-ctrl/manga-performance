import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  buildCollectionPeriods,
  collectionClients,
  collectionEntities,
  collectionMonths,
  collectionPlans,
  collectionTemplates,
} from "@/lib/mock/collection";
import { REFERENCE_DATE } from "@/lib/constants";
import type {
  CollectionClient,
  CollectionEntity,
  CollectionOverview,
  CollectionPeriod,
  CollectionPlan,
  CollectionSubmission,
  ControlIssue,
  Sector,
  SubmissionReport,
  TrackingRow,
} from "@/lib/types/collection";
import { ServiceError } from "./data-source";
import { latency } from "./store";

/*
 * Module Collecte, version mock (avenant n°1, étape A1). Le branchement base de données arrive
 * avec l'étape B7 : les signatures ci-dessous sont celles que les Server Actions reprendront.
 */

const state = {
  periods: buildCollectionPeriods(),
  entities: structuredClone(collectionEntities),
  plans: structuredClone(collectionPlans),
  reminderRules: { beforeDue: 2, afterDue: [1, 3] as number[], escalationDay: 5, cap: 4, sendHour: 8 },
};

const NOW = () => new Date(REFERENCE_DATE);

function rowsFor(): TrackingRow[] {
  return state.plans.map((plan) => {
    const entity = state.entities.find((e) => e.id === plan.entityId)!;
    return {
      plan,
      entity,
      client: collectionClients.find((c) => c.id === entity.clientId)!,
      template: collectionTemplates.find((t) => t.id === plan.templateId)!,
      periods: state.periods.filter((p) => p.planId === plan.id),
    };
  });
}

export const getCollectionOverview = (): Promise<CollectionOverview> =>
  latency(() => ({ clients: collectionClients, months: collectionMonths, rows: rowsFor() }));

export interface PeriodDetail {
  period: CollectionPeriod;
  row: TrackingRow;
}

export const getPeriodDetail = (periodId: string): Promise<PeriodDetail> =>
  latency(() => {
    const period = state.periods.find((p) => p.id === periodId);
    const row = period && rowsFor().find((r) => r.plan.id === period.planId);
    if (!period || !row) throw new ServiceError("Période introuvable.", "NOT_FOUND");
    return { period: structuredClone(period), row: structuredClone(row) };
  });

/** Forçage admin : « accepté avec réserve », commentaire obligatoire (avenant §7). */
export const forcePeriod = (periodId: string, comment: string): Promise<void> =>
  latency(() => {
    if (comment.trim().length < 5) throw new ServiceError("Un commentaire est obligatoire pour accepter avec réserve.", "COMMENT_REQUIRED");
    const period = state.periods.find((p) => p.id === periodId);
    const last = period?.submissions.at(-1);
    if (!period || !last) throw new ServiceError("Aucun dépôt à accepter pour cette période.", "NO_SUBMISSION");
    last.status = "ACCEPTE_AVEC_RESERVE";
    last.reviewComment = comment.trim();
    period.status = "ACCEPTE_AVEC_RESERVE";
  });

/** Relance manuelle d'une ou plusieurs périodes (plafond de relances par période). Retourne le nombre de relances envoyées. */
export const remindPeriods = (periodIds: string[]): Promise<number> =>
  latency(() => {
    let sent = 0;
    for (const id of periodIds) {
      const period = state.periods.find((p) => p.id === id);
      if (!period || !["EN_RETARD", "ATTENDU", "REJETE"].includes(period.status)) continue;
      if (period.reminders.length >= state.reminderRules.cap) continue;
      period.reminders.push({ at: NOW().toISOString(), kind: "MANUELLE", recipients: "Contributeurs de l'entité" });
      sent++;
    }
    return sent;
  });

export const listCollectionEntities = (): Promise<{ entities: CollectionEntity[]; plans: CollectionPlan[]; clients: CollectionClient[] }> =>
  latency(() => ({ entities: structuredClone(state.entities), plans: structuredClone(state.plans), clients: collectionClients }));

export const createCollectionEntity = (input: { clientId: string; name: string; sector: Sector }): Promise<CollectionEntity> =>
  latency(() => {
    const name = input.name.trim();
    if (name.length < 2) throw new ServiceError("Le nom de l'entité est requis.", "VALIDATION");
    if (state.entities.some((e) => e.clientId === input.clientId && e.name.toLowerCase() === name.toLowerCase()))
      throw new ServiceError("Une entité porte déjà ce nom chez ce client.", "DUPLICATE");
    const entity: CollectionEntity = { id: `ce-${state.entities.length + 1}`, clientId: input.clientId, name, sector: input.sector };
    state.entities.push(entity);
    return entity;
  });

export const getReminderRules = () => latency(() => structuredClone(state.reminderRules));
export const saveReminderRules = (rules: typeof state.reminderRules): Promise<void> =>
  latency(() => {
    if (rules.cap < 1 || rules.cap > 10) throw new ServiceError("Le plafond doit être compris entre 1 et 10.", "VALIDATION");
    state.reminderRules = structuredClone(rules);
  });

/* ---------- Espace client ---------- */

export type CollectionViewerRole = "CLIENT_DIRECTION" | "CLIENT_CONTRIBUTEUR" | "CLIENT_ANALYSTE";
export const VIEWER_ROLE_LABELS: Record<CollectionViewerRole, string> = {
  CLIENT_DIRECTION: "Direction",
  CLIENT_CONTRIBUTEUR: "Contributeur",
  CLIENT_ANALYSTE: "Analyste",
};

/** Démo : le client connecté est le premier client fictif ; le contributeur n'a que l'hôtel « Les Cocotiers » (affectation). */
const DEMO_CLIENT_ID = "cc-1";
const DEMO_CONTRIBUTOR_ENTITIES = ["ce-1"];

/** `entityScope` du mock (avenant §3) : la seule source des entités visibles pour chaque rôle. */
export function entityScope(role: CollectionViewerRole): string[] {
  const own = state.entities.filter((e) => e.clientId === DEMO_CLIENT_ID).map((e) => e.id);
  return role === "CLIENT_CONTRIBUTEUR" ? own.filter((id) => DEMO_CONTRIBUTOR_ENTITIES.includes(id)) : own;
}

export const getClientCollection = (role: CollectionViewerRole): Promise<CollectionOverview> =>
  latency(() => {
    const scope = entityScope(role);
    return { clients: collectionClients.filter((c) => c.id === DEMO_CLIENT_ID), months: collectionMonths, rows: rowsFor().filter((r) => scope.includes(r.entity.id)) };
  });

/** Dépôt simulé : un fichier .xlsx dont le nom contient « rejet » produit un rapport d'erreurs, les autres sont validés. */
export const submitDeposit = (periodId: string, file: { name: string; size: number }, role: CollectionViewerRole): Promise<CollectionSubmission> =>
  latency(() => {
    if (role === "CLIENT_ANALYSTE") throw new ServiceError("Votre rôle est en lecture seule : vous ne pouvez pas déposer.", "FORBIDDEN");
    const period = state.periods.find((p) => p.id === periodId);
    const row = period && rowsFor().find((r) => r.plan.id === period.planId);
    if (!period || !row || !entityScope(role).includes(row.entity.id)) throw new ServiceError("Cette période n'est pas dans votre périmètre.", "FORBIDDEN");
    if (!["ATTENDU", "EN_RETARD", "REJETE"].includes(period.status)) throw new ServiceError("Aucun dépôt n'est attendu pour cette période.", "NOT_EXPECTED");
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsm") || lower.endsWith(".xls")) throw new ServiceError("Format refusé : seuls les fichiers .xlsx sont acceptés (ni .xls, ni .xlsm).", "BAD_FORMAT");
    if (!lower.endsWith(".xlsx")) throw new ServiceError("Format refusé : déposez un fichier Excel .xlsx.", "BAD_FORMAT");
    if (file.size > 10 * 1024 * 1024) throw new ServiceError("Fichier trop volumineux (10 Mo maximum).", "TOO_LARGE");

    const rejected = lower.includes("rejet");
    const report: SubmissionReport = rejected
      ? {
          errors: [{ row: 3, column: "Quantité livrée", value: "-2", message: "Ligne 3, Quantité livrée : -2 doit être supérieur à 0." } satisfies ControlIssue],
          warnings: [],
        }
      : { errors: [], warnings: [] };
    const submission: CollectionSubmission = {
      id: `s-${periodId}-${period.submissions.length + 1}`,
      version: period.submissions.length + 1,
      originalName: file.name,
      uploadedBy: VIEWER_ROLE_LABELS[role],
      uploadedAt: NOW().toISOString(),
      status: rejected ? "REJETE" : "VALIDE",
      report,
    };
    period.submissions.push(submission);
    period.status = submission.status;
    return structuredClone(submission);
  });

/** Compte à rebours lisible : « dans 3 jours », « 2 jours de retard ». */
export function dueLabel(dueAt: string): { text: string; late: boolean } {
  const days = Math.ceil((new Date(dueAt).getTime() - NOW().getTime()) / 86_400_000);
  if (days < 0) return { text: `${-days} jour${-days > 1 ? "s" : ""} de retard`, late: true };
  if (days === 0) return { text: "à rendre aujourd'hui", late: false };
  return { text: `dans ${days} jour${days > 1 ? "s" : ""}`, late: false };
}

export const periodLabel = (p: CollectionPeriod) => format(new Date(p.periodStart), "MMMM yyyy", { locale: fr });
