import {
  PILOT_MONTHS,
  VALIDATED_UNTIL,
  initialParams,
  pilotHotels,
  pilotState,
  resultsFor,
  type ComputeVersion,
  type HotelMonthResult,
  type PilotHotel,
  type PilotParams,
} from "@/lib/mock/pilot";
import * as actions from "@/server/actions/collection";
import type { CpraParamsView } from "@/server/collection/cpra-service";
import { ServiceError, USE_DB, unwrap } from "./data-source";
import { latency } from "./store";

/*
 * Pilote hôtellerie (avenant n°1, étapes A2 puis B8 à B10). Version mock : les résultats sont calculés
 * avec les fonctions pures du moteur réel à partir de dépôts fictifs. Le branchement base de données
 * remplacera ces fonctions sans changer leurs signatures.
 */

export type { EcartRow, HotelMonthResult, PilotHotel } from "@/lib/mock/pilot";

/** Période calculée du pilote : le consultant valide chaque version avant exposition au client. */
export interface PilotPeriodInfo {
  id: string;
  hotelId: string;
  hotelName: string;
  clientId: string;
  clientName: string;
  monthKey: string;
  monthLabel: string;
  templateId: string;
  version: number | null;
  computedAt: string | null;
  computedBy: string | null;
  note: string | null;
  validatedAt: string | null;
  status: string;
}

export interface PilotResults {
  version: number;
  /** Les paramètres ont été modifiés depuis ce calcul : un recalcul est nécessaire (démo). */
  stale: boolean;
  hotels: PilotHotel[];
  months: { key: string; label: string }[];
  results: HotelMonthResult[];
  /** Mois visibles du client (validés par le consultant). */
  validatedUntil: string;
  /** Présent en mode `db` : périodes, versions et état de validation. */
  clients?: { id: string; name: string }[];
  clientId?: string | null;
  periods?: PilotPeriodInfo[];
}

export interface PilotVersionInfo {
  version: number;
  at: string;
  by: string;
  note: string;
}

const same = (a: PilotParams, b: PilotParams) => JSON.stringify(a) === JSON.stringify(b);
const latest = (): ComputeVersion => pilotState.versions[pilotState.versions.length - 1]!;
const months = PILOT_MONTHS.map(({ key, label }) => ({ key, label }));

export const getPilotParams = (): Promise<PilotParams> => latency(() => structuredClone(pilotState.draft));

/** Paramètres réels du pilote (mode `db`) : catalogue, conversions, normes datées et facteurs long séjour. */
export const getPilotParamsDb = (clientId?: string): Promise<CpraParamsView> =>
  USE_DB ? unwrap(actions.getCpraParamsAction({ clientId: clientId ?? "" })) : Promise.reject(new ServiceError("Paramètres disponibles avec la base de données.", "VALIDATION"));

/** Corrige un facteur de conversion manquant (le badge rouge disparaît au recalcul). */
export const savePilotConversion = (productId: string, deliveryUnit: string, factor: number | null): Promise<void> =>
  USE_DB ? unwrap(actions.setCpraConversionAction({ productId, deliveryUnit, factor })).then(() => undefined) : Promise.reject(new ServiceError("Enregistrement disponible avec la base de données.", "VALIDATION"));

export const savePilotProduct = (input: { clientId: string; code: string; label: string; referenceUnit: "unite" | "ml"; active?: boolean }): Promise<{ id: string }> =>
  USE_DB ? unwrap(actions.saveCpraProductAction(input)) : Promise.reject(new ServiceError("Enregistrement disponible avec la base de données.", "VALIDATION"));

export const addPilotNorm = (input: { productId: string; entityId: string | null; validFrom: string; normPerClient: number; nonUserRate: number; unitCostFcfa: number }): Promise<void> =>
  USE_DB ? unwrap(actions.addCpraNormAction(input)).then(() => undefined) : Promise.reject(new ServiceError("Enregistrement disponible avec la base de données.", "VALIDATION"));

export const setPilotLongStayFactor = (input: { entityId: string; validFrom: string; factor: number }): Promise<void> =>
  USE_DB ? unwrap(actions.setLongStayFactorAction(input)).then(() => undefined) : Promise.reject(new ServiceError("Enregistrement disponible avec la base de données.", "VALIDATION"));

export const savePilotBounds = (input: { clientId: string; strongUnder: number; under: number; overFrom: number; strongOver: number }): Promise<void> =>
  USE_DB ? unwrap(actions.saveCpraBoundsAction(input)).then(() => undefined) : Promise.reject(new ServiceError("Enregistrement disponible avec la base de données.", "VALIDATION"));

/** Enregistre le brouillon des paramètres. Les résultats ne changent qu'au prochain recalcul. */
export const savePilotParams = (params: PilotParams): Promise<void> =>
  latency(() => {
    for (const p of params.products) {
      if (!(p.unitCost >= 0)) throw new ServiceError(`Coût unitaire invalide pour ${p.label}.`, "VALIDATION");
      if (!(p.nonUserRate >= 0 && p.nonUserRate <= 1)) throw new ServiceError(`Le taux de non-utilisateurs de ${p.label} doit être compris entre 0 et 1.`, "VALIDATION");
    }
    if (params.conversions.some((c) => c.factor !== null && !(c.factor > 0))) throw new ServiceError("Un facteur de conversion doit être strictement positif.", "VALIDATION");
    if (params.norms.some((n) => !(n.normPerClient >= 0))) throw new ServiceError("Une norme ne peut pas être négative.", "VALIDATION");
    if (Object.values(params.longStayFactor).some((f) => !(f >= 1))) throw new ServiceError("Le facteur long séjour doit être au moins égal à 1.", "VALIDATION");
    pilotState.draft = structuredClone(params);
  });

export const getPilotVersions = (): Promise<PilotVersionInfo[]> =>
  USE_DB
    ? getPilotResults().then((data) =>
        [...new Map((data.periods ?? []).filter((p) => p.version !== null && p.computedAt).map((p) => [p.version!, { version: p.version!, at: p.computedAt!, by: p.computedBy ?? "", note: p.note ?? "" }])).values()].sort((a, b) => b.version - a.version),
      )
    : latency(() => pilotState.versions.map(({ version, at, by, note }) => ({ version, at, by, note })).reverse());

/** Recalcul explicite : une nouvelle version est créée, les anciennes restent consultables (avenant §9). */
export const recomputePilot = (note: string): Promise<number> =>
  latency(() => {
    const version = latest().version + 1;
    pilotState.versions.push({ version, at: new Date().toISOString(), by: "Consultant (démo)", note: note.trim() || "Recalcul manuel", params: structuredClone(pilotState.draft) });
    return version;
  });

/** Recalcul d'une période réelle : le moteur CPRA ou celui des KPI selon le modèle du plan. */
export const recomputePilotPeriod = async (periodId: string, templateId: string, note: string): Promise<{ version: number }> => {
  if (!USE_DB) throw new ServiceError("Recalcul disponible avec la base de données.", "VALIDATION");
  if (templateId === "hotel_consommables_cpro") return unwrap(actions.recomputeCpraAction({ periodId, note }));
  return unwrap(actions.recomputeHotelKpisAction({ periodId, note }));
};

/** Validation du consultant : la version devient visible dans l'espace client. */
export const validatePilotPeriod = (periodId: string): Promise<void> =>
  USE_DB ? unwrap(actions.validatePilotPeriodAction({ periodId })).then(() => undefined) : Promise.reject(new ServiceError("Validation disponible avec la base de données.", "VALIDATION"));

export const getPilotResults = (version?: number, clientId?: string): Promise<PilotResults> =>
  USE_DB
    ? unwrap(actions.getPilotResultsAction({ clientId }))
    : latency(() => {
        const chosen = version ? pilotState.versions.find((v) => v.version === version) : latest();
        if (!chosen) throw new ServiceError("Version de calcul introuvable.", "NOT_FOUND");
        return { version: chosen.version, stale: !same(pilotState.draft, chosen.params), hotels: pilotHotels, months, results: resultsFor(chosen), validatedUntil: VALIDATED_UNTIL };
      });

/**
 * Vue du client (direction et analyste, lecture seule) : dernière version, mois validés uniquement
 * (défaut de l'avenant : visibles après validation du consultant).
 */
export const getClientPilotResults = (): Promise<PilotResults> =>
  USE_DB
    ? unwrap(actions.getPilotResultsAction({}))
    : latency(() => {
    const current = latest();
    const allowed = PILOT_MONTHS.filter((m) => m.key <= VALIDATED_UNTIL).map((m) => m.key as string);
    return {
      version: current.version,
      stale: false,
      hotels: pilotHotels,
      months: months.filter((m) => allowed.includes(m.key)),
      results: resultsFor(current).filter((r) => allowed.includes(r.monthKey)),
      validatedUntil: VALIDATED_UNTIL,
    };
  });

/** Pour les tests et la démo : remet les paramètres et les versions à l'état initial. */
export const resetPilot = (): void => {
  pilotState.draft = initialParams();
  pilotState.versions.splice(1);
};
