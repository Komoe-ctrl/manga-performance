import type { CoverageStatus } from "@manga/core/kpi/consumables";
import type { HotelAlert, HotelKpis } from "@manga/core/kpi/hotel";
import type { PrismaClient } from "@manga/db";
import { CPRA_TEMPLATE_ID } from "@manga/db/cpra";
import { HOTEL_KPI_TEMPLATE_ID, parseHotelKpis } from "@manga/db/hotel-kpi";
import type { EcartRow, HotelMonthResult, PilotHotel, PilotPeriodInfo, PilotResults } from "@/lib/services/pilot";
import { DomainError } from "../domain-error";

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const monthLabel = (date: Date) => {
  const text = MONTH.format(date);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

const EMPTY_KPIS: HotelKpis = {
  chambresDisponibles: 0,
  gop: 0,
  revpar: null,
  trevpar: null,
  goppar: null,
  gopMarginPct: null,
  tauxOccupationPct: null,
  adr: null,
  poidsOtaPct: null,
};

const ALERT_LEVELS = new Set(["alert", "watch", "info", "missing"]);

/** Relit les alertes d'un snapshot JSON sans faire confiance à leur forme. */
function parseAlerts(value: unknown): HotelAlert[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is HotelAlert => {
    if (typeof a !== "object" || a === null) return false;
    const row = a as Partial<HotelAlert>;
    return typeof row.code === "string" && typeof row.message === "string" && typeof row.level === "string" && ALERT_LEVELS.has(row.level);
  });
}

function parseNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCharges(value: unknown): { chargesDepartementales: number; chargesNonReparties: number } {
  const input = (value as { input?: Record<string, unknown> } | null)?.input;
  return {
    chargesDepartementales: parseNumber(input?.chargesDepartementales) ?? 0,
    chargesNonReparties: parseNumber(input?.chargesNonReparties) ?? 0,
  };
}

/** L'unité de livraison sans facteur qui a rendu le CPRO incalculable, si le snapshot la mentionne. */
function missingConversion(row: { status: string; paramsSnapshot: unknown }): string | undefined {
  if (row.status !== "CONVERSION_MANQUANTE") return undefined;
  const lines = (row.paramsSnapshot as { lines?: { deliveryUnit?: unknown; factor?: unknown }[] } | null)?.lines;
  return lines?.find((line) => line.factor === null && typeof line.deliveryUnit === "string")?.deliveryUnit as string | undefined;
}

type VersionRow = { version: number; validatedAt: Date | null; computedAt: Date; note: string | null; computedBy: string | null };

interface Bucket {
  hotel: PilotHotel;
  clientId: string;
  clientName: string;
  month: { key: string; label: string };
  cpra: (VersionRow & { periodId: string }) | null;
  kpi: (VersionRow & { periodId: string }) | null;
}

export interface PilotQuery {
  /** `null` : admin, tous les clients disposant d'un pilote. */
  clientId: string | null;
  /** Le client ne voit que les versions validées par le consultant. */
  clientOnly: boolean;
}

/**
 * Écrans pilote branchés sur les dépôts réels (avenant n°1, §10 et B10). Les résultats sont lus dans les
 * snapshots versionnés de B8/B9 ; le client ne reçoit que les versions que le consultant a validées.
 */
export function createPilotService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  return {
    async results(query: PilotQuery): Promise<PilotResults> {
      const periods = await prisma.collectionPeriod.findMany({
        where: {
          plan: {
            templateId: { in: [CPRA_TEMPLATE_ID, HOTEL_KPI_TEMPLATE_ID] },
            entity: { sector: "HOTELLERIE", ...(query.clientId ? { clientId: query.clientId } : {}) },
          },
        },
        select: {
          id: true,
          periodStart: true,
          status: true,
          plan: { select: { templateId: true, entity: { select: { id: true, name: true, clientId: true, client: { select: { legalName: true } } } } } },
        },
        orderBy: [{ periodStart: "asc" }, { id: "asc" }],
      });

      const buckets = new Map<string, Bucket>();
      const periodInfos: PilotPeriodInfo[] = [];

      for (const period of periods) {
        const [cpraVersions, kpiVersions] = await Promise.all([
          prisma.cpraResult.findMany({ where: { periodId: period.id }, select: { version: true, validatedAt: true, computedAt: true, note: true, computedBy: true }, orderBy: { version: "desc" } }),
          prisma.hotelKpiResult.findMany({ where: { periodId: period.id }, select: { version: true, validatedAt: true, computedAt: true, note: true, computedBy: true }, orderBy: { version: "desc" } }),
        ]);
        // Le client lit la dernière version *validée*, pas la plus récente : un recalcul non validé ne
        // remplace jamais ce qu'il voyait déjà.
        const pick = (versions: VersionRow[]) => (query.clientOnly ? versions.find((v) => v.validatedAt !== null) : versions[0]);
        const cpraVersion = pick(cpraVersions);
        const kpiVersion = pick(kpiVersions);
        if (!cpraVersion && !kpiVersion) continue;

        const entity = period.plan.entity;
        const key = `${entity.id}|${monthKey(period.periodStart)}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            hotel: { id: entity.id, name: entity.name, rooms: 0 },
            clientId: entity.clientId,
            clientName: entity.client.legalName,
            month: { key: monthKey(period.periodStart), label: monthLabel(period.periodStart) },
            cpra: null,
            kpi: null,
          };
          buckets.set(key, bucket);
        }
        const version = period.plan.templateId === CPRA_TEMPLATE_ID ? cpraVersion : kpiVersion;
        if (!version) continue; // Dépôt d'un autre modèle : aucune version exploitable pour cette période.
        const chosen = { periodId: period.id, ...version };
        if (period.plan.templateId === CPRA_TEMPLATE_ID) bucket.cpra = chosen;
        else bucket.kpi = chosen;
        const validatedAt = [cpraVersion?.validatedAt, kpiVersion?.validatedAt].filter((d): d is Date => d instanceof Date).sort((a, b) => (a > b ? 1 : -1))[0] ?? null;
        periodInfos.push({
          id: period.id,
          hotelId: entity.id,
          hotelName: entity.name,
          clientId: entity.clientId,
          clientName: entity.client.legalName,
          monthKey: bucket.month.key,
          monthLabel: bucket.month.label,
          templateId: period.plan.templateId,
          version: chosen.version,
          computedAt: chosen.computedAt.toISOString(),
          computedBy: chosen.computedBy,
          note: chosen.note,
          validatedAt: validatedAt?.toISOString() ?? null,
          status: period.status,
        });
      }

      const results: HotelMonthResult[] = [];
      let maxVersion = 0;
      let validatedUntil = "";

      for (const bucket of buckets.values()) {
        let ecarts: EcartRow[] = [];
        if (bucket.cpra) {
          const rows = await prisma.cpraResult.findMany({
            where: { periodId: bucket.cpra.periodId, version: bucket.cpra.version },
            orderBy: { product: { code: "asc" } },
            include: { product: { select: { code: true, label: true, referenceUnit: true } } },
          });
          ecarts = rows.map((row) => {
            const conversion = missingConversion(row);
            return {
              productCode: row.product.code,
              productLabel: row.product.label,
              referenceUnit: row.product.referenceUnit === "ml" ? ("ml" as const) : ("unite" as const),
              cpra: Number(row.cpra),
              cpro: row.cproRef === null ? null : Number(row.cproRef),
              ecartVolume: row.ecartVolume === null ? null : Number(row.ecartVolume),
              couverturePct: row.couverture === null ? null : Number(row.couverture),
              ecartValorise: row.ecartValorise,
              status: row.status as CoverageStatus,
              ...(conversion ? { missingConversion: conversion } : {}),
            };
          });
        }

        const kpiRow = bucket.kpi ? await prisma.hotelKpiResult.findUnique({ where: { periodId_version: { periodId: bucket.kpi.periodId, version: bucket.kpi.version } } }) : null;
        const kpis = (kpiRow && parseHotelKpis(kpiRow.kpis)) || EMPTY_KPIS;
        const rooms = parseNumber((kpiRow?.paramsSnapshot as { input?: { nombreChambres?: unknown } } | null)?.input?.nombreChambres);
        if (rooms && rooms > 0) bucket.hotel.rooms = rooms;
        if (ecarts.length === 0 && !kpiRow) continue;

        if (bucket.cpra) maxVersion = Math.max(maxVersion, bucket.cpra.version);
        if (bucket.kpi) maxVersion = Math.max(maxVersion, bucket.kpi.version);
        const validatedAt = [bucket.cpra?.validatedAt, bucket.kpi?.validatedAt].filter((d): d is Date => d instanceof Date).sort((a, b) => (a > b ? 1 : -1))[0] ?? null;
        if (validatedAt && bucket.month.key > validatedUntil) validatedUntil = bucket.month.key;

        const charges = parseCharges(kpiRow?.paramsSnapshot);
        results.push({
          hotelId: bucket.hotel.id,
          monthKey: bucket.month.key,
          ecarts,
          totalEcartValorise: ecarts.reduce((sum, e) => sum + (e.ecartValorise ?? 0), 0),
          kpis,
          // §11 bis : les alertes restent réservées au consultant, même si le client voit les KPI.
          alerts: query.clientOnly ? [] : parseAlerts(kpiRow?.alerts),
          structure: { ...charges, gop: kpis.gop },
          hasKpis: kpiRow !== null,
        });
      }

      const hotels: PilotHotel[] = [];
      const clients: { id: string; name: string }[] = [];
      const months: { key: string; label: string }[] = [];
      for (const result of results) {
        const bucket = buckets.get(`${result.hotelId}|${result.monthKey}`)!;
        if (!hotels.some((h) => h.id === bucket.hotel.id)) hotels.push(bucket.hotel);
        if (!clients.some((c) => c.id === bucket.clientId)) clients.push({ id: bucket.clientId, name: bucket.clientName });
        if (!months.some((m) => m.key === bucket.month.key)) months.push(bucket.month);
      }
      months.sort((a, b) => a.key.localeCompare(b.key));

      return {
        version: maxVersion,
        stale: false,
        hotels,
        months,
        results,
        validatedUntil,
        clients: query.clientOnly ? undefined : clients,
        clientId: query.clientId,
        periods: query.clientOnly ? undefined : periodInfos.sort((a, b) => b.monthKey.localeCompare(a.monthKey) || a.hotelName.localeCompare(b.hotelName)),
      };
    },

    /** Valide la dernière version calculée d'une période ; c'est le seul moyen de l'exposer au client. */
    async validate(periodId: string, actorId: string): Promise<{ cpra: number | null; kpi: number | null; unchanged: boolean }> {
      const period = await prisma.collectionPeriod.findUnique({
        where: { id: periodId },
        select: {
          id: true,
          plan: { select: { templateId: true } },
          cpraResults: { orderBy: { version: "desc" }, take: 1, select: { version: true, validatedAt: true } },
          hotelKpiResults: { orderBy: { version: "desc" }, take: 1, select: { version: true, validatedAt: true } },
        },
      });
      if (!period) throw new DomainError("NOT_FOUND", "Période introuvable.");
      const cpra = period.plan.templateId === CPRA_TEMPLATE_ID ? period.cpraResults[0] : undefined;
      const kpi = period.plan.templateId === HOTEL_KPI_TEMPLATE_ID ? period.hotelKpiResults[0] : undefined;
      if (!cpra && !kpi) throw new DomainError("CONFLICT", "Aucun résultat calculé à valider pour cette période.");

      const cpraTarget = cpra && !cpra.validatedAt ? cpra : null;
      const kpiTarget = kpi && !kpi.validatedAt ? kpi : null;
      if (!cpraTarget && !kpiTarget) return { cpra: cpra?.version ?? null, kpi: kpi?.version ?? null, unchanged: true };

      const now = new Date();
      await prisma.$transaction([
        ...(cpraTarget ? [prisma.cpraResult.updateMany({ where: { periodId, version: cpraTarget.version, validatedAt: null }, data: { validatedAt: now, validatedBy: actorId } })] : []),
        ...(kpiTarget ? [prisma.hotelKpiResult.updateMany({ where: { periodId, version: kpiTarget.version, validatedAt: null }, data: { validatedAt: now, validatedBy: actorId } })] : []),
        prisma.auditLog.create({
          data: {
            actorId,
            action: "PILOT_RESULTS_VALIDATED",
            entity: "CollectionPeriod",
            entityId: periodId,
            diff: { cpraVersion: cpraTarget?.version ?? null, kpiVersion: kpiTarget?.version ?? null },
          },
        }),
      ]);
      return { cpra: cpra?.version ?? null, kpi: kpi?.version ?? null, unchanged: false };
    },
  };
}

export type PilotService = ReturnType<typeof createPilotService>;
