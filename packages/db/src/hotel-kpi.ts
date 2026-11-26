import { daysInPeriod, formatDateFr, parseNumber, type NormalizedRow } from "@manga/core/collection";
import { hotelAlerts, hotelKpis, type HotelAlert, type HotelInput, type HotelKpis } from "@manga/core/kpi/hotel";
import { Prisma, type PrismaClient } from "./generated/client";
import type { JobQueue } from "./queue";

/** Modèle de collecte dont les dépôts alimentent les KPI hôteliers (avenant n°1, §11.2 et §11 bis). */
export const HOTEL_KPI_TEMPLATE_ID = "hotel_mensuel";
const SHEET = "Saisie_Mensuelle";

/** Champs obligatoires du modèle, avec le libellé utilisé dans l'alerte `INPUT_MISSING`. */
const REQUIRED_FIELDS: readonly (readonly [keyof HotelInput, string])[] = [
  ["nombreChambres", "Nombre de chambres"],
  ["chambresVendues", "Chambres vendues"],
  ["caChambres", "CA Chambres HT"],
  ["revenusTotaux", "Revenus totaux d'exploitation HT"],
  ["chargesDepartementales", "Charges départementales"],
  ["chargesNonReparties", "Charges non réparties"],
];

const numberOrNull = (value: unknown): number | null => {
  const parsed = parseNumber(value as Parameters<typeof parseNumber>[0]);
  return parsed.ok ? parsed.value : null;
};

export interface HotelKpiContext {
  entityId: string;
  entityName: string;
  clientId: string;
  clientName: string;
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
}

export type ComputeHotelKpiOutcome =
  | {
      computed: true;
      version: number;
      submissionId: string;
      kpis: HotelKpis;
      alerts: HotelAlert[];
      previous: HotelKpis | null;
      missing: string[];
      context: HotelKpiContext;
    }
  | { computed: false; reason: "NOT_FOUND" | "NOT_HOTEL_PLAN" | "NO_ACCEPTED_SUBMISSION" | "ALREADY_COMPUTED" | "RACE" };

export interface ComputeHotelKpiOptions {
  periodId: string;
  /** `null` pour le job automatique. */
  actorId: string | null;
  note?: string;
  /** Recalcul explicite : crée une nouvelle version même si ce dépôt a déjà été calculé. */
  force: boolean;
}

const KPI_KEYS: readonly (keyof HotelKpis)[] = [
  "chambresDisponibles",
  "gop",
  "revpar",
  "trevpar",
  "goppar",
  "gopMarginPct",
  "tauxOccupationPct",
  "adr",
  "poidsOtaPct",
];

/** Relit un snapshot JSON sans jamais faire confiance à sa forme. */
export function parseHotelKpis(value: unknown): HotelKpis | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!KPI_KEYS.every((key) => key in row)) return null;
  const read = (key: keyof HotelKpis): number | null => {
    const v = row[key];
    if (v === null) return null;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  if (read("chambresDisponibles") === null || read("gop") === null) return null;
  return {
    chambresDisponibles: read("chambresDisponibles")!,
    gop: read("gop")!,
    revpar: read("revpar"),
    trevpar: read("trevpar"),
    goppar: read("goppar"),
    gopMarginPct: read("gopMarginPct"),
    tauxOccupationPct: read("tauxOccupationPct"),
    adr: read("adr"),
    poidsOtaPct: read("poidsOtaPct"),
  };
}

/** Le mois calendaire précédent, en jours UTC (les périodes du module sont des jours calendaires). */
function previousMonthStart(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
}

async function loadPreviousKpis(prisma: PrismaClient, planId: string, periodStart: Date): Promise<HotelKpis | null> {
  const previous = await prisma.collectionPeriod.findUnique({
    where: { planId_periodStart: { planId, periodStart: previousMonthStart(periodStart) } },
    select: { id: true },
  });
  if (!previous) return null;
  const latest = await prisma.hotelKpiResult.findFirst({
    where: { periodId: previous.id },
    orderBy: { version: "desc" },
    select: { kpis: true },
  });
  return latest ? parseHotelKpis(latest.kpis) : null;
}

/**
 * Calcule les KPI d'un hôtel pour une période à partir de son dépôt retenu (le plus récent `VALIDE` ou
 * `ACCEPTE_AVEC_RESERVE`). Chaque calcul est une version : un recalcul n'écrase rien. Le job automatique
 * (`force: false`) est idempotent : un dépôt déjà calculé n'est pas recalculé.
 *
 * Le GOP n'est jamais lu dans le dépôt : il est dérivé des revenus et des charges (avenant §4.2). Les
 * valeurs manquantes donnent `null` (jamais NaN) et une alerte `INPUT_MISSING`.
 */
export async function computeHotelKpisForPeriod(prisma: PrismaClient, options: ComputeHotelKpiOptions): Promise<ComputeHotelKpiOutcome> {
  const period = await prisma.collectionPeriod.findUnique({
    where: { id: options.periodId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      plan: {
        select: {
          id: true,
          templateId: true,
          entity: { select: { id: true, name: true, clientId: true, client: { select: { legalName: true } } } },
        },
      },
    },
  });
  if (!period) return { computed: false, reason: "NOT_FOUND" };
  if (period.plan.templateId !== HOTEL_KPI_TEMPLATE_ID) return { computed: false, reason: "NOT_HOTEL_PLAN" };

  const submission = await prisma.submission.findFirst({
    where: { periodId: period.id, status: { in: ["VALIDE", "ACCEPTE_AVEC_RESERVE"] } },
    orderBy: { version: "desc" },
    select: { id: true, rows: true },
  });
  if (!submission) return { computed: false, reason: "NO_ACCEPTED_SUBMISSION" };

  const latest = await prisma.hotelKpiResult.findFirst({ where: { periodId: period.id }, orderBy: { version: "desc" }, select: { version: true, submissionId: true } });
  if (!options.force && latest?.submissionId === submission.id) return { computed: false, reason: "ALREADY_COMPUTED" };

  const rows = (submission.rows ?? {}) as Record<string, NormalizedRow[]>;
  const raw = rows[SHEET]?.[0] ?? {};
  const value = (key: keyof HotelInput): number | null => numberOrNull(raw[key]);
  const missing = REQUIRED_FIELDS.filter(([key]) => value(key) === null).map(([, label]) => label);

  const input: HotelInput = {
    nombreChambres: value("nombreChambres") ?? 0,
    chambresVendues: value("chambresVendues") ?? 0,
    caChambres: value("caChambres") ?? 0,
    revenusTotaux: value("revenusTotaux") ?? 0,
    chargesDepartementales: value("chargesDepartementales") ?? 0,
    chargesNonReparties: value("chargesNonReparties") ?? 0,
    commissionsOta: value("commissionsOta"),
    jours: daysInPeriod(period.periodStart, period.periodEnd),
  };
  const kpis = hotelKpis(input);
  const previous = await loadPreviousKpis(prisma, period.plan.id, period.periodStart);
  const alerts = hotelAlerts(kpis, { previous, missing });

  const context: HotelKpiContext = {
    entityId: period.plan.entity.id,
    entityName: period.plan.entity.name,
    clientId: period.plan.entity.clientId,
    clientName: period.plan.entity.client.legalName,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodLabel: `${formatDateFr(period.periodStart)} – ${formatDateFr(period.periodEnd)}`,
  };
  const version = (latest?.version ?? 0) + 1;
  const snapshot = {
    templateId: HOTEL_KPI_TEMPLATE_ID,
    sheet: SHEET,
    submissionId: submission.id,
    input,
    missing,
    period: { start: period.periodStart.toISOString(), end: period.periodEnd.toISOString() },
    previousVersion: previous ? { revpar: previous.revpar, goppar: previous.goppar } : null,
  };

  try {
    await prisma.$transaction([
      prisma.hotelKpiResult.create({
        data: {
          periodId: period.id,
          submissionId: submission.id,
          version,
          kpis: kpis as unknown as Prisma.InputJsonValue,
          alerts: alerts as unknown as Prisma.InputJsonValue,
          previous: (previous ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
          paramsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          note: options.note?.trim() || null,
          computedBy: options.actorId,
        },
      }),
      prisma.auditLog.create({
        data: {
          actorId: options.actorId,
          action: "HOTEL_KPIS_COMPUTED",
          entity: "CollectionPeriod",
          entityId: period.id,
          diff: { version, submissionId: submission.id, alertCodes: alerts.map((a) => a.code), missing, forced: options.force } as Prisma.InputJsonValue,
        },
      }),
    ]);
  } catch (error) {
    // Two computations raced for the same version: the unique key kept the first one.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") return { computed: false, reason: "RACE" };
    throw error;
  }
  return { computed: true, version, submissionId: submission.id, kpis, alerts, previous, missing, context };
}

export interface HotelAlertNotificationInput {
  /** Adresse du consultant (jamais une adresse client). */
  to: string;
  appUrl: string;
  periodId: string;
  version: number;
  context: HotelKpiContext;
  kpis: HotelKpis;
  alerts: HotelAlert[];
}

/** Notifie le consultant quand des alertes KPI sont déclenchées ; le dédoublage est lié à la version calculée. */
export async function notifyConsultantOfHotelAlerts(
  queue: Pick<JobQueue, "enqueueEmail">,
  input: HotelAlertNotificationInput,
): Promise<boolean> {
  if (input.alerts.length === 0) return false;
  await queue.enqueueEmail(
    {
      template: "hotel-kpi-alert",
      to: input.to,
      data: {
        entityName: input.context.entityName,
        clientName: input.context.clientName,
        periodLabel: input.context.periodLabel,
        alerts: input.alerts.map((a) => ({ code: a.code, level: a.level, message: a.message })),
        revpar: input.kpis.revpar,
        trevpar: input.kpis.trevpar,
        gop: input.kpis.gop,
        goppar: input.kpis.goppar,
        gopMarginPct: input.kpis.gopMarginPct,
        adminUrl: `${input.appUrl.replace(/\/$/, "")}/admin/collecte`,
      },
    },
    { dedupeKey: `hotel-kpi-alert:${input.periodId}:${input.version}` },
  );
  return true;
}
