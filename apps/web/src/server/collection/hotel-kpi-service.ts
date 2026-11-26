import type { HotelAlert, HotelKpis } from "@manga/core/kpi/hotel";
import type { PrismaClient } from "@manga/db";
import { computeHotelKpisForPeriod, HOTEL_KPI_TEMPLATE_ID, notifyConsultantOfHotelAlerts, parseHotelKpis } from "@manga/db/hotel-kpi";
import type { JobQueue } from "@manga/db/queue";
import { DomainError } from "../domain-error";

export interface HotelKpiResultView {
  version: number;
  computedAt: string;
  note: string | null;
  computedBy: string | null;
  kpis: HotelKpis;
  alerts: HotelAlert[];
  previous: HotelKpis | null;
}

function parseAlerts(value: unknown): HotelAlert[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is HotelAlert => typeof a === "object" && a !== null && typeof (a as HotelAlert).code === "string" && typeof (a as HotelAlert).level === "string" && typeof (a as HotelAlert).message === "string");
}

/**
 * KPI hôteliers calculés et versionnés (avenant n°1, §11.2 et §11 bis). Administration seulement :
 * appelé derrière `requireAdmin`. Modifier le dépôt ne touche jamais un résultat existant ; seul un
 * recalcul crée une nouvelle version et notifie le consultant si des alertes sont déclenchées.
 */
export function createHotelKpiService(deps: {
  prisma: PrismaClient;
  queue: Pick<JobQueue, "enqueueEmail">;
  notification: { to: string; appUrl: string };
}) {
  const { prisma, queue, notification } = deps;

  return {
    /** Recalcul explicite : nouvelle version, l'ancienne reste consultable. */
    async recompute(periodId: string, note: string, actorId: string): Promise<{ version: number; alerts: number }> {
      const outcome = await computeHotelKpisForPeriod(prisma, { periodId, actorId, note: note.slice(0, 200), force: true });
      if (!outcome.computed) {
        const messages = {
          NOT_FOUND: ["NOT_FOUND", "Période introuvable."],
          NOT_HOTEL_PLAN: ["VALIDATION", "Cette période n'est pas un modèle « Hôtel — KPI mensuels »."],
          NO_ACCEPTED_SUBMISSION: ["CONFLICT", "Aucun dépôt validé ou accepté avec réserve pour cette période."],
          ALREADY_COMPUTED: ["CONFLICT", "Déjà calculé."],
          RACE: ["CONFLICT", "Un calcul est déjà en cours pour cette période, réessayez."],
        } as const;
        const [code, message] = messages[outcome.reason];
        throw new DomainError(code, message);
      }
      if (outcome.alerts.length > 0) {
        await notifyConsultantOfHotelAlerts(queue, {
          to: notification.to,
          appUrl: notification.appUrl,
          periodId,
          version: outcome.version,
          context: outcome.context,
          kpis: outcome.kpis,
          alerts: outcome.alerts,
        });
      }
      return { version: outcome.version, alerts: outcome.alerts.length };
    },

    /** Résultat d'une période, à une version donnée (la dernière par défaut), et la liste des versions. */
    async results(periodId: string, version?: number): Promise<{
      versions: { version: number; computedAt: string; note: string | null }[];
      version: number | null;
      result: HotelKpiResultView | null;
    }> {
      const period = await prisma.collectionPeriod.findUnique({ where: { id: periodId }, select: { plan: { select: { templateId: true } } } });
      if (!period) throw new DomainError("NOT_FOUND", "Période introuvable.");
      if (period.plan.templateId !== HOTEL_KPI_TEMPLATE_ID) return { versions: [], version: null, result: null };
      const rows = await prisma.hotelKpiResult.findMany({ where: { periodId }, orderBy: { version: "desc" } });
      const versions = rows.map((r) => ({ version: r.version, computedAt: r.computedAt.toISOString(), note: r.note }));
      const chosen = version ?? versions[0]?.version ?? null;
      if (version !== undefined && !versions.some((v) => v.version === version)) throw new DomainError("NOT_FOUND", "Version introuvable.");
      const row = rows.find((r) => r.version === chosen);
      const kpis = row ? parseHotelKpis(row.kpis) : null;
      return {
        versions,
        version: chosen,
        result: row && kpis
          ? {
              version: row.version,
              computedAt: row.computedAt.toISOString(),
              note: row.note,
              computedBy: row.computedBy,
              kpis,
              alerts: parseAlerts(row.alerts),
              previous: parseHotelKpis(row.previous),
            }
          : null,
      };
    },
  };
}

export type HotelKpiService = ReturnType<typeof createHotelKpiService>;
