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
import { ServiceError } from "./data-source";
import { latency } from "./store";

/*
 * Pilote hôtellerie (avenant n°1, étapes A2 puis B8 à B10). Version mock : les résultats sont calculés
 * avec les fonctions pures du moteur réel à partir de dépôts fictifs. Le branchement base de données
 * remplacera ces fonctions sans changer leurs signatures.
 */

export interface PilotResults {
  version: number;
  /** Les paramètres ont été modifiés depuis ce calcul : un recalcul est nécessaire. */
  stale: boolean;
  hotels: PilotHotel[];
  months: { key: string; label: string }[];
  results: HotelMonthResult[];
  /** Mois visibles du client (validés par le consultant). */
  validatedUntil: string;
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
  latency(() => pilotState.versions.map(({ version, at, by, note }) => ({ version, at, by, note })).reverse());

/** Recalcul explicite : une nouvelle version est créée, les anciennes restent consultables (avenant §9). */
export const recomputePilot = (note: string): Promise<number> =>
  latency(() => {
    const version = latest().version + 1;
    pilotState.versions.push({ version, at: new Date().toISOString(), by: "Consultant (démo)", note: note.trim() || "Recalcul manuel", params: structuredClone(pilotState.draft) });
    return version;
  });

export const getPilotResults = (version?: number): Promise<PilotResults> =>
  latency(() => {
    const chosen = version ? pilotState.versions.find((v) => v.version === version) : latest();
    if (!chosen) throw new ServiceError("Version de calcul introuvable.", "NOT_FOUND");
    return { version: chosen.version, stale: !same(pilotState.draft, chosen.params), hotels: pilotHotels, months, results: resultsFor(chosen), validatedUntil: VALIDATED_UNTIL };
  });

/**
 * Vue du client (direction et analyste, lecture seule) : dernière version, mois validés uniquement
 * (défaut de l'avenant : visibles après validation du consultant).
 */
export const getClientPilotResults = (): Promise<PilotResults> =>
  latency(() => {
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
