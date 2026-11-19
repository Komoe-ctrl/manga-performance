import { getTemplate, TEMPLATES } from "@manga/core/collection";
import { periodLabelOf } from "@manga/db/collection-jobs";
import type { PrismaClient } from "@manga/db";
import type {
  CollectionClient,
  CollectionEntity,
  CollectionOverview,
  CollectionPeriod,
  CollectionPlan,
  CollectionReminder,
  CollectionSubmission,
  ControlIssue,
  Sector,
  SubmissionReport,
  TrackingRow,
} from "@/lib/types/collection";
import { DomainError } from "../domain-error";
import { entityScope, type CollectionActor } from "./scope";

/** Mois affichés dans le tableau de suivi (le mois en cours inclus : il n'a pas encore de période). */
export const OVERVIEW_MONTHS = 7;

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });

/** Les `OVERVIEW_MONTHS` derniers mois se terminant au mois de `now`, du plus ancien au plus récent. */
export function overviewMonths(now: Date): { key: string; label: string; start: Date }[] {
  return Array.from({ length: OVERVIEW_MONTHS }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (OVERVIEW_MONTHS - 1 - i), 1));
    return { key: start.toISOString().slice(0, 7), label: MONTH_LABEL.format(start).replace(".", ""), start };
  });
}

type StoredIssue = { row?: number | null; columnLabel?: string | null; value?: string | null; message?: string };

/** Rapport stocké (moteur de contrôle) vers la forme attendue par les écrans. */
export function toReport(raw: unknown): SubmissionReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { errors?: StoredIssue[]; warnings?: StoredIssue[] };
  const map = (list: StoredIssue[] | undefined): ControlIssue[] =>
    (list ?? []).map((i) => ({
      ...(typeof i.row === "number" ? { row: i.row } : {}),
      ...(i.columnLabel ? { column: i.columnLabel } : {}),
      ...(i.value ? { value: i.value } : {}),
      message: String(i.message ?? ""),
    }));
  return { errors: map(r.errors), warnings: map(r.warnings) };
}

const iso = (d: Date) => d.toISOString();

const SUBMISSION_SELECT = {
  id: true,
  version: true,
  originalName: true,
  uploadedBy: true,
  uploadedAt: true,
  status: true,
  report: true,
  reviewComment: true,
} as const;

type SubmissionRow = {
  id: string;
  version: number;
  originalName: string;
  uploadedBy: string;
  uploadedAt: Date;
  status: string;
  report: unknown;
  reviewComment: string | null;
};

export function createCollectionReadService(deps: { prisma: PrismaClient; now?: () => Date }) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());

  async function names(userIds: string[]): Promise<Map<string, string>> {
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  const toSubmission = (s: SubmissionRow, who: Map<string, string>): CollectionSubmission | null =>
    // A technical failure never produced a result: it is not shown as a deposit.
    s.status === "ERREUR_TECHNIQUE"
      ? null
      : {
          id: s.id,
          version: s.version,
          originalName: s.originalName,
          uploadedBy: who.get(s.uploadedBy) ?? "—",
          uploadedAt: iso(s.uploadedAt),
          status: s.status as CollectionSubmission["status"],
          report: toReport(s.report),
          ...(s.reviewComment ? { reviewComment: s.reviewComment } : {}),
        };

  async function remindersOf(periodIds: string[]): Promise<Map<string, CollectionReminder[]>> {
    const rows = await prisma.auditLog.findMany({ where: { action: "collection.reminder", entityId: { in: periodIds } }, orderBy: { createdAt: "asc" }, select: { entityId: true, createdAt: true, diff: true } });
    const out = new Map<string, CollectionReminder[]>();
    for (const row of rows) {
      const diff = (row.diff ?? {}) as { kind?: string; escalation?: boolean };
      const kind = (["J-2", "J+1", "J+3", "J+5", "MANUELLE"].includes(String(diff.kind)) ? diff.kind : "MANUELLE") as CollectionReminder["kind"];
      const list = out.get(row.entityId ?? "") ?? [];
      list.push({ at: iso(row.createdAt), kind, recipients: diff.escalation ? "Contributeurs et direction du client" : "Contributeurs de l'entité" });
      out.set(row.entityId ?? "", list);
    }
    return out;
  }

  /** Plans, entités et périodes du périmètre de l'acteur : la seule porte d'entrée est `entityScope`. */
  async function rows(actor: CollectionActor, entityId?: string): Promise<{ rows: TrackingRow[]; clients: CollectionClient[]; months: ReturnType<typeof overviewMonths> }> {
    const scope = await entityScope(prisma, actor);
    const ids = entityId ? scope.filter((id) => id === entityId) : scope;
    const months = overviewMonths(now());
    const since = months[0]!.start;

    const plans = await prisma.collectionPlan.findMany({
      where: { entityId: { in: ids } },
      orderBy: [{ entity: { name: "asc" } }, { templateId: "asc" }],
      select: {
        id: true,
        entityId: true,
        templateId: true,
        frequency: true,
        delayDays: true,
        startsOn: true,
        active: true,
        entity: { select: { id: true, clientId: true, name: true, sector: true, client: { select: { id: true, legalName: true } } } },
        periods: {
          where: { periodStart: { gte: since } },
          orderBy: { periodStart: "asc" },
          select: { id: true, planId: true, periodStart: true, periodEnd: true, dueAt: true, status: true, submissions: { orderBy: { version: "asc" }, select: SUBMISSION_SELECT } },
        },
      },
    });

    const who = await names(plans.flatMap((p) => p.periods.flatMap((per) => per.submissions.map((s) => s.uploadedBy))));
    const reminders = await remindersOf(plans.flatMap((p) => p.periods.map((per) => per.id)));

    const clients = new Map<string, CollectionClient>();
    const out: TrackingRow[] = [];
    for (const plan of plans) {
      const template = getTemplate(plan.templateId);
      if (!template) continue; // a plan whose template was removed from the code: nothing to show
      clients.set(plan.entity.client.id, { id: plan.entity.client.id, name: plan.entity.client.legalName });
      out.push({
        plan: { id: plan.id, entityId: plan.entityId, templateId: plan.templateId, frequency: plan.frequency, delayDays: plan.delayDays, startsOn: iso(plan.startsOn), active: plan.active },
        entity: { id: plan.entity.id, clientId: plan.entity.clientId, name: plan.entity.name, sector: plan.entity.sector as Sector },
        client: { id: plan.entity.client.id, name: plan.entity.client.legalName },
        template: { id: template.id, label: template.label, sector: template.sector },
        periods: plan.periods.map<CollectionPeriod>((p) => ({
          id: p.id,
          planId: p.planId,
          periodStart: iso(p.periodStart),
          periodEnd: iso(p.periodEnd),
          dueAt: iso(p.dueAt),
          status: p.status,
          submissions: p.submissions.map((s) => toSubmission(s, who)).filter((s): s is CollectionSubmission => s !== null),
          reminders: reminders.get(p.id) ?? [],
        })),
      });
    }
    return { rows: out, clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name)), months };
  }

  return {
    /** Tableau de suivi : admin (tout), direction et analyste (leur client), contributeur (ses entités). */
    async overview(actor: CollectionActor): Promise<CollectionOverview> {
      const data = await rows(actor);
      return { viewerRole: actor.role, clients: data.clients, months: data.months.map(({ key, label }) => ({ key, label })), rows: data.rows };
    },

    /** Détail d'une période, avec son rang de suivi. Hors périmètre ou inexistante : même réponse. */
    async periodDetail(actor: CollectionActor, periodId: string): Promise<{ period: CollectionPeriod; row: TrackingRow }> {
      const found = await prisma.collectionPeriod.findUnique({ where: { id: periodId }, select: { plan: { select: { entityId: true } } } });
      if (!found) throw new DomainError("NOT_FOUND", "Période introuvable.");
      const data = await rows(actor, found.plan.entityId);
      for (const row of data.rows) {
        const period = row.periods.find((p) => p.id === periodId);
        if (period) return { period, row };
      }
      // Out of scope, or older than the displayed window: load it on its own, still scoped.
      const scope = await entityScope(prisma, actor);
      if (!scope.includes(found.plan.entityId)) throw new DomainError("NOT_FOUND", "Période introuvable.");
      const p = await prisma.collectionPeriod.findUniqueOrThrow({
        where: { id: periodId },
        select: { id: true, planId: true, periodStart: true, periodEnd: true, dueAt: true, status: true, submissions: { orderBy: { version: "asc" }, select: SUBMISSION_SELECT } },
      });
      const base = data.rows.find((r) => r.plan.id === p.planId);
      if (!base) throw new DomainError("NOT_FOUND", "Période introuvable.");
      const who = await names(p.submissions.map((s) => s.uploadedBy));
      const reminders = (await remindersOf([p.id])).get(p.id) ?? [];
      const period: CollectionPeriod = {
        id: p.id,
        planId: p.planId,
        periodStart: iso(p.periodStart),
        periodEnd: iso(p.periodEnd),
        dueAt: iso(p.dueAt),
        status: p.status,
        submissions: p.submissions.map((s) => toSubmission(s, who)).filter((s): s is CollectionSubmission => s !== null),
        reminders,
      };
      return { period, row: base };
    },

    /** Entités et plans pour l'écran d'administration. */
    async entitiesAndPlans(actor: CollectionActor): Promise<{ entities: CollectionEntity[]; plans: CollectionPlan[]; clients: CollectionClient[] }> {
      const scope = await entityScope(prisma, actor);
      const entities = await prisma.entity.findMany({
        where: { id: { in: scope } },
        orderBy: { name: "asc" },
        select: { id: true, clientId: true, name: true, sector: true, client: { select: { id: true, legalName: true } }, plans: { select: { id: true, entityId: true, templateId: true, frequency: true, delayDays: true, startsOn: true, active: true } } },
      });
      const clients = new Map<string, CollectionClient>();
      for (const e of entities) clients.set(e.client.id, { id: e.client.id, name: e.client.legalName });
      if (actor.role === "ADMIN") {
        // The admin can create the first entity of a client that has none yet.
        for (const c of await prisma.client.findMany({ where: { deletedAt: null }, select: { id: true, legalName: true } })) clients.set(c.id, { id: c.id, name: c.legalName });
      }
      return {
        entities: entities.map((e) => ({ id: e.id, clientId: e.clientId, name: e.name, sector: e.sector as Sector })),
        plans: entities.flatMap((e) => e.plans.map((p) => ({ ...p, startsOn: iso(p.startsOn) }))),
        clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
  };
}

export type CollectionReadService = ReturnType<typeof createCollectionReadService>;

/** Libellé de période, pour les messages (« octobre 2026 »). */
export const labelOfPeriod = (start: Date, end: Date) => periodLabelOf(start, end);

/** Modèles proposés à la création d'un plan, pour un secteur. */
export const templatesOfSector = (sector: Sector) => TEMPLATES.filter((t) => t.sector === sector).map((t) => ({ id: t.id, label: t.label, sector: t.sector }));
