import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { dayOffset } from "@manga/core/collection/calendar";
import {
  buildCollectionPeriods,
  collectionAssignments,
  collectionClients,
  collectionEntities,
  collectionMonths,
  collectionPeople,
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
import * as actions from "@/server/actions/collection";
import { ServiceError, USE_DB, unwrap } from "./data-source";
import { latency } from "./store";

/*
 * Module Collecte (avenant n°1). `DATA_SOURCE=mock` : données fictives en mémoire (démo). `db` : les
 * Server Actions de `server/actions/collection.ts`, qui passent toutes par `entityScope`.
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
  USE_DB ? unwrap(actions.getCollectionOverviewAction()) : latency(() => ({ clients: collectionClients, months: collectionMonths, rows: rowsFor() }));

export interface PeriodDetail {
  period: CollectionPeriod;
  row: TrackingRow;
}

export const getPeriodDetail = (periodId: string): Promise<PeriodDetail> =>
  USE_DB ? unwrap(actions.getPeriodDetailAction(periodId)) : latency(() => {
    const period = state.periods.find((p) => p.id === periodId);
    const row = period && rowsFor().find((r) => r.plan.id === period.planId);
    if (!period || !row) throw new ServiceError("Période introuvable.", "NOT_FOUND");
    return { period: structuredClone(period), row: structuredClone(row) };
  });

/** Forçage admin : « accepté avec réserve », commentaire obligatoire (avenant §7). */
export const forcePeriod = (periodId: string, comment: string): Promise<void> =>
  USE_DB ? unwrap(actions.forcePeriodAction({ periodId, comment })).then(() => undefined) : latency(() => {
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
  USE_DB ? unwrap(actions.remindPeriodsAction(periodIds)) : latency(() => {
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
  USE_DB ? unwrap(actions.listCollectionEntitiesAction()) : latency(() => ({ entities: structuredClone(state.entities), plans: structuredClone(state.plans), clients: collectionClients }));

export const createCollectionEntity = (input: { clientId: string; name: string; sector: Sector }): Promise<CollectionEntity> =>
  USE_DB ? unwrap(actions.createCollectionEntityAction(input)) : latency(() => {
    const name = input.name.trim();
    if (name.length < 2) throw new ServiceError("Le nom de l'entité est requis.", "VALIDATION");
    if (state.entities.some((e) => e.clientId === input.clientId && e.name.toLowerCase() === name.toLowerCase()))
      throw new ServiceError("Une entité porte déjà ce nom chez ce client.", "DUPLICATE");
    const entity: CollectionEntity = { id: `ce-${state.entities.length + 1}`, clientId: input.clientId, name, sector: input.sector };
    state.entities.push(entity);
    return entity;
  });

export const getReminderRules = (): Promise<typeof state.reminderRules> => (USE_DB ? unwrap(actions.getReminderRulesAction()) : latency(() => structuredClone(state.reminderRules)));
export const saveReminderRules = (rules: typeof state.reminderRules): Promise<void> =>
  USE_DB ? unwrap(actions.saveReminderRulesAction(rules)).then(() => undefined) : latency(() => {
    if (rules.cap < 1 || rules.cap > 10) throw new ServiceError("Le plafond doit être compris entre 1 et 10.", "VALIDATION");
    state.reminderRules = structuredClone(rules);
  });

export interface CollectionPerson {
  id: string;
  clientId: string;
  name: string;
  email: string;
  role: "CLIENT_DIRECTION" | "CLIENT_CONTRIBUTEUR" | "CLIENT_ANALYSTE";
  active: boolean;
}

/** Démo : direction, contributeur et analyste de chaque client de la collecte (les mêmes que ceux de la connexion de démo). */
const demoPeople: CollectionPerson[] = structuredClone(collectionPeople);
const demoAssignments: { userId: string; entityId: string }[] = structuredClone(collectionAssignments);

/** Mois (`AAAA-MM`) d'une période : la clé des colonnes du tableau de suivi. */
export const monthKey = (p: Pick<CollectionPeriod, "periodStart">) => p.periodStart.slice(0, 7);

/**
 * Complétude du dernier mois clos : dépôts acceptés sur dépôts attendus. Le « dernier mois clos » est la dernière colonne
 * dont au moins une période n'est plus « à venir » : il suit donc la date du jour (les statuts viennent du calendrier).
 */
export function monthCompleteness(rows: Pick<TrackingRow, "periods">[], months: { key: string; label: string }[]): { key: string; label: string; complete: number; expected: number } | null {
  const lastClosed = [...months].reverse().find((m) => rows.some((r) => r.periods.find((p) => monthKey(p) === m.key)?.status !== "A_VENIR"));
  if (!lastClosed) return null;
  const closed = rows.map((r) => r.periods.find((p) => monthKey(p) === lastClosed.key)).filter((p): p is CollectionPeriod => !!p && p.status !== "A_VENIR");
  const complete = closed.filter((p) => p.status === "VALIDE" || p.status === "ACCEPTE_AVEC_RESERVE").length;
  return { ...lastClosed, complete, expected: closed.length };
}

/** Crée le compte d'un client avec le rôle choisi et envoie l'invitation. `mock` : compte fictif. */
export const inviteCollectionUser = (input: { clientId: string; name: string; email: string; role: CollectionPerson["role"] }): Promise<void> =>
  USE_DB
    ? unwrap(actions.inviteCollectionUserAction(input)).then(() => undefined)
    : latency(() => {
        if (demoPeople.some((p) => p.email === input.email.trim().toLowerCase())) throw new ServiceError("Cette adresse email a déjà un compte.", "EMAIL_TAKEN");
        demoPeople.push({ id: `cu-${demoPeople.length + 1}`, clientId: input.clientId, name: input.name.trim(), email: input.email.trim().toLowerCase(), role: input.role, active: true });
      });

export const createCollectionPlan = (input: { entityId: string; templateId: string; frequency: "MENSUELLE" | "HEBDOMADAIRE"; delayDays: number; startsOn: string }): Promise<CollectionPlan> =>
  USE_DB
    ? unwrap(actions.createCollectionPlanAction(input))
    : latency(() => {
        const entity = state.entities.find((e) => e.id === input.entityId);
        const template = collectionTemplates.find((t) => t.id === input.templateId);
        if (!entity || !template) throw new ServiceError("Entité ou modèle introuvable.", "NOT_FOUND");
        if (template.sector !== entity.sector) throw new ServiceError("Ce modèle ne correspond pas au secteur de l'entité.", "VALIDATION");
        if (state.plans.some((p) => p.entityId === entity.id && p.templateId === template.id)) throw new ServiceError("Cette entité a déjà un plan pour ce modèle.", "DUPLICATE");
        const plan: CollectionPlan = { id: `cp-${state.plans.length + 1}`, entityId: entity.id, templateId: template.id, frequency: input.frequency, delayDays: input.delayDays, startsOn: new Date(`${input.startsOn}T00:00:00Z`).toISOString(), active: true };
        state.plans.push(plan);
        return structuredClone(plan);
      });

export const setCollectionPlanActive = (planId: string, active: boolean): Promise<CollectionPlan> =>
  USE_DB
    ? unwrap(actions.setCollectionPlanActiveAction({ planId, active }))
    : latency(() => {
        const plan = state.plans.find((p) => p.id === planId);
        if (!plan) throw new ServiceError("Plan introuvable.", "NOT_FOUND");
        plan.active = active;
        return structuredClone(plan);
      });

export const listCollectionPeople = (): Promise<{ users: CollectionPerson[]; assignments: { userId: string; entityId: string }[] }> =>
  USE_DB ? unwrap(actions.listCollectionPeopleAction()) : latency(() => ({ users: structuredClone(demoPeople), assignments: structuredClone(demoAssignments) }));

export const assignContributor = (entityId: string, userId: string): Promise<void> =>
  USE_DB
    ? unwrap(actions.assignContributorAction({ entityId, userId })).then(() => undefined)
    : latency(() => {
        if (demoPeople.find((p) => p.id === userId)?.role !== "CLIENT_CONTRIBUTEUR") throw new ServiceError("Seul un utilisateur « contributeur » peut être affecté à une entité.", "NOT_CONTRIBUTOR");
        if (!demoAssignments.some((a) => a.userId === userId && a.entityId === entityId)) demoAssignments.push({ userId, entityId });
      });

export const unassignContributor = (entityId: string, userId: string): Promise<void> =>
  USE_DB
    ? unwrap(actions.unassignContributorAction({ entityId, userId })).then(() => undefined)
    : latency(() => {
        const index = demoAssignments.findIndex((a) => a.userId === userId && a.entityId === entityId);
        if (index >= 0) demoAssignments.splice(index, 1);
      });

/** Lien de téléchargement (5 minutes) du fichier original d'un dépôt. `mock` : pas de fichier. */
export const downloadSubmission = (submissionId: string): Promise<{ url: string; filename: string }> =>
  USE_DB ? unwrap(actions.downloadSubmissionAction(submissionId)) : latency(() => { throw new ServiceError("Téléchargement disponible avec la base de données (DATA_SOURCE=db).", "MOCK"); });

/** Excel à remplir pour une période (route protégée par la session). */
export const templateUrl = (periodId: string) => `/api/collection/template/${encodeURIComponent(periodId)}`;

export interface CollectionExportFilters {
  templateId: string;
  from: string;
  to: string;
  clientId?: string;
  sector?: string;
  entityId?: string;
}

/** Export consolidé : `xlsx` ou `zip` des fichiers originaux. */
export function exportUrl(filters: CollectionExportFilters, format: "xlsx" | "zip" = "xlsx"): string {
  const query = new URLSearchParams({ templateId: filters.templateId, from: filters.from, to: filters.to });
  for (const key of ["clientId", "sector", "entityId"] as const) if (filters[key]) query.set(key, filters[key]!);
  if (format === "zip") query.set("format", "zip");
  return `/api/collection/export?${query}`;
}

/* ---------- Espace client ---------- */

export type CollectionViewerRole = "CLIENT_DIRECTION" | "CLIENT_CONTRIBUTEUR" | "CLIENT_ANALYSTE";
export const VIEWER_ROLE_LABELS: Record<CollectionViewerRole, string> = {
  CLIENT_DIRECTION: "Direction",
  CLIENT_CONTRIBUTEUR: "Contributeur",
  CLIENT_ANALYSTE: "Analyste",
};

/**
 * `entityScope` du mock (avenant §3) : la seule source des entités visibles. Le client vient de la session (jamais d'un
 * choix libre) ; le rôle de la démo ne change que ce qui est affiché *chez ce client* : le contributeur ne voit que les
 * entités qui lui sont affectées. Un client inconnu n'a accès à rien.
 */
export function entityScope(role: CollectionViewerRole, clientId: string): string[] {
  const own = state.entities.filter((e) => e.clientId === clientId).map((e) => e.id);
  if (role !== "CLIENT_CONTRIBUTEUR") return own;
  const contributors = new Set(demoPeople.filter((p) => p.clientId === clientId && p.role === "CLIENT_CONTRIBUTEUR").map((p) => p.id));
  const assigned = new Set(demoAssignments.filter((a) => contributors.has(a.userId)).map((a) => a.entityId));
  return own.filter((id) => assigned.has(id));
}

/** `db` : la session décide du périmètre (ni le rôle ni le client passés ici ne comptent). `mock` : `clientId` est celui de la session de démo. */
export const getClientCollection = (role: CollectionViewerRole, clientId: string): Promise<CollectionOverview> =>
  USE_DB ? unwrap(actions.getCollectionOverviewAction()) : latency(() => {
    const scope = entityScope(role, clientId);
    return { clients: collectionClients.filter((c) => c.id === clientId), months: collectionMonths, rows: rowsFor().filter((r) => scope.includes(r.entity.id)) };
  });

/** Dépôt simulé : un fichier .xlsx dont le nom contient « rejet » produit un rapport d'erreurs, les autres sont validés. */
export const submitDeposit = (periodId: string, file: { name: string; size: number } | File, role: CollectionViewerRole, clientId: string): Promise<CollectionSubmission> =>
  USE_DB ? depositToStorage(periodId, file as File) : latency(() => {
    if (role === "CLIENT_ANALYSTE") throw new ServiceError("Votre rôle est en lecture seule : vous ne pouvez pas déposer.", "FORBIDDEN");
    const period = state.periods.find((p) => p.id === periodId);
    const row = period && rowsFor().find((r) => r.plan.id === period.planId);
    if (!period || !row || !entityScope(role, clientId).includes(row.entity.id)) throw new ServiceError("Cette période n'est pas dans votre périmètre.", "FORBIDDEN");
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

/**
 * `db` : envoie le fichier au stockage privé (URL présignée), puis confirme. Le contrôle est fait par le
 * worker : le dépôt revient « en contrôle », et l'écran se rafraîchit pour afficher le résultat.
 */
async function depositToStorage(periodId: string, file: File): Promise<CollectionSubmission> {
  if (!(file instanceof File)) throw new ServiceError("Choisissez un fichier .xlsx à déposer.", "INVALID");
  const ticket = await unwrap(actions.requestDepositUploadAction({ periodId, filename: file.name, sizeBytes: file.size }));
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: file });
  } catch {
    throw new ServiceError("Impossible d'envoyer le fichier. Vérifiez votre connexion.", "NETWORK");
  }
  if (!response.ok) throw new ServiceError("L'envoi du fichier a échoué. Réessayez.", String(response.status));
  const created = await unwrap(actions.confirmDepositAction({ periodId, key: ticket.key, originalName: file.name }));
  return { id: created.submissionId, version: created.version, originalName: file.name, uploadedBy: "", uploadedAt: new Date().toISOString(), status: "EN_CONTROLE", report: null };
}

/** Compte à rebours lisible : « dans 3 jours », « 2 jours de retard ». */
export function dueLabel(dueAt: string): { text: string; late: boolean } {
  // Same day arithmetic as the server (calendar days, due day included): a due date 54 days ago is 54 days late.
  const now = USE_DB ? new Date() : NOW();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const offset = dayOffset(new Date(dueAt), today);
  if (offset > 0) return { text: `${offset} jour${offset > 1 ? "s" : ""} de retard`, late: true };
  if (offset === 0) return { text: "à rendre aujourd'hui", late: false };
  return { text: `dans ${-offset} jour${-offset > 1 ? "s" : ""}`, late: false };
}

export const periodLabel = (p: CollectionPeriod) => format(new Date(p.periodStart), "MMMM yyyy", { locale: fr });
