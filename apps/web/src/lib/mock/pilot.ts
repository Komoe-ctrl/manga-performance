import { consumableResult, cpra, cpro, DEFAULT_COVERAGE_BOUNDS, type ConsumableResult, type CoverageStatus } from "@manga/core/kpi/consumables";
import { hotelAlerts, hotelKpis, type HotelAlert, type HotelKpis } from "@manga/core/kpi/hotel";
import { collectionEntities } from "@/lib/mock/collection";

/*
 * Pilote hôtellerie, données de démonstration (avenant n°1, §10 et §11 bis). Tout est fictif : 3 hôtels
 * inventés, des quantités et des montants générés. Les résultats ne sont pas écrits en dur : ils sont
 * calculés avec les mêmes fonctions pures que le moteur réel (`@manga/core/kpi`).
 */

export const PILOT_MONTHS = [
  { key: "2026-04", label: "Avril 2026", days: 30 },
  { key: "2026-05", label: "Mai 2026", days: 31 },
  { key: "2026-06", label: "Juin 2026", days: 30 },
  { key: "2026-07", label: "Juillet 2026", days: 31 },
  { key: "2026-08", label: "Août 2026", days: 31 },
  { key: "2026-09", label: "Septembre 2026", days: 30 },
] as const;
export type PilotMonthKey = (typeof PILOT_MONTHS)[number]["key"];

/** Les mois jusqu'à août sont validés par le consultant ; septembre attend sa validation (invisible du client). */
export const VALIDATED_UNTIL: PilotMonthKey = "2026-08";

export interface PilotHotel {
  id: string;
  name: string;
  rooms: number;
}

const ROOMS: Record<string, number> = { "ce-1": 48, "ce-2": 72, "ce-3": 30 };
export const pilotHotels: PilotHotel[] = collectionEntities.filter((e) => e.sector === "HOTELLERIE").map((e) => ({ id: e.id, name: e.name, rooms: ROOMS[e.id] ?? 40 }));

/* ---------- Paramètres CPRA ---------- */

export type ReferenceUnit = "unite" | "ml";

export interface PilotProduct {
  code: string;
  label: string;
  referenceUnit: ReferenceUnit;
  /** Coût unitaire en FCFA par unité de référence (peut être fractionnaire : 0,5 FCFA/ml). */
  unitCost: number;
  /** Part de la clientèle qui n'utilise pas le produit (0 à 1). */
  nonUserRate: number;
}

export interface PilotConversion {
  productCode: string;
  deliveryUnit: string;
  /** Facteur vers l'unité de référence ; `null` tant qu'il n'est pas renseigné (badge rouge). */
  factor: number | null;
}

export interface PilotNorm {
  productCode: string;
  /** `null` : norme par défaut du client. */
  hotelId: string | null;
  validFrom: string;
  normPerClient: number;
}

export interface PilotParams {
  products: PilotProduct[];
  conversions: PilotConversion[];
  norms: PilotNorm[];
  longStayFactor: Record<string, number>;
}

export const initialParams = (): PilotParams => ({
  products: [
    { code: "PH", label: "Papier hygiénique", referenceUnit: "unite", unitCost: 70, nonUserRate: 0.15 },
    { code: "JAVEL", label: "Eau de Javel", referenceUnit: "ml", unitCost: 0.5, nonUserRate: 0 },
    { code: "GEL", label: "Gel douche", referenceUnit: "ml", unitCost: 0.6, nonUserRate: 0 },
    { code: "SHAMP", label: "Shampooing", referenceUnit: "ml", unitCost: 0.8, nonUserRate: 0.1 },
  ],
  conversions: [
    { productCode: "PH", deliveryUnit: "Rouleau", factor: 1 },
    // À confirmer par le client : combien de rouleaux dans un paquet ?
    { productCode: "PH", deliveryUnit: "Paquet", factor: null },
    { productCode: "JAVEL", deliveryUnit: "Bidon 5 L", factor: 5_000 },
    { productCode: "GEL", deliveryUnit: "Bidon 4 L", factor: 4_000 },
    { productCode: "SHAMP", deliveryUnit: "Flacon 500 ml", factor: 500 },
  ],
  norms: [
    { productCode: "PH", hotelId: null, validFrom: "2026-01-01", normPerClient: 1 },
    { productCode: "JAVEL", hotelId: null, validFrom: "2026-01-01", normPerClient: 40 },
    { productCode: "GEL", hotelId: null, validFrom: "2026-01-01", normPerClient: 25 },
    // Norme propre à un hôtel, avec date d'effet : l'historique des mois passés ne change pas.
    { productCode: "GEL", hotelId: "ce-3", validFrom: "2026-07-01", normPerClient: 30 },
    { productCode: "SHAMP", hotelId: null, validFrom: "2026-01-01", normPerClient: 20 },
  ],
  longStayFactor: { "ce-1": 1.1, "ce-2": 1.133, "ce-3": 1.0 },
});

/** Norme applicable : la dernière date d'effet ≤ début de période ; celle de l'hôtel l'emporte sur celle du client. */
export function normFor(params: PilotParams, productCode: string, hotelId: string, monthKey: string): number | null {
  const start = `${monthKey}-01`;
  const applicable = params.norms.filter((n) => n.productCode === productCode && n.validFrom <= start);
  const pick = (list: PilotNorm[]) => [...list].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return (pick(applicable.filter((n) => n.hotelId === hotelId)) ?? pick(applicable.filter((n) => n.hotelId === null)))?.normPerClient ?? null;
}

/* ---------- Dépôts fictifs ---------- */

export interface PilotPopulation {
  clientsPass: number;
  clientsLongSejour: number;
}

export interface PilotDelivery {
  productCode: string;
  deliveryUnit: string;
  quantity: number;
}

export interface PilotMonthData {
  population: PilotPopulation;
  /** Une ligne par livraison (avenant §4.6). Un produit absent de la liste : CPRO manquant. */
  deliveries: PilotDelivery[];
  kpiInput: { chambresVendues: number; caChambres: number; revenusTotaux: number; chargesDepartementales: number; chargesNonReparties: number; commissionsOta: number };
}

/** Suite pseudo-aléatoire déterministe : la démo est identique à chaque chargement. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return s / 4_294_967_296;
  };
}

/** Écarts voulus pour la démonstration : (hôtel|mois|produit) → rapport CPRO / CPRA. `null` : aucune livraison. */
const COVERAGE_PLAN: Record<string, number | null> = {
  "ce-1|2026-06|GEL": 1.32,
  "ce-1|2026-08|PH": 0.72,
  "ce-2|2026-05|JAVEL": 1.12,
  "ce-2|2026-08|SHAMP": 0.88,
  "ce-3|2026-06|SHAMP": null,
  "ce-3|2026-09|GEL": 1.24,
};
/** Livraison en « Paquet » (conversion non renseignée) : le CPRO n'est pas calculable. */
const PACKET_PLAN = new Set(["ce-2|2026-07|PH"]);

const DELIVERY_UNIT: Record<string, string> = { PH: "Rouleau", JAVEL: "Bidon 5 L", GEL: "Bidon 4 L", SHAMP: "Flacon 500 ml" };

/** Anomalies de KPI : marge GOP basse en août (ce-2), coûts qui progressent plus vite que les revenus en septembre (ce-3). */
const COST_RATIO: Record<string, number> = { "ce-2|2026-08": 0.74, "ce-3|2026-09": 0.7 };

function buildData(params: PilotParams): Record<string, Record<string, PilotMonthData>> {
  const out: Record<string, Record<string, PilotMonthData>> = {};
  pilotHotels.forEach((hotel, h) => {
    out[hotel.id] = {};
    PILOT_MONTHS.forEach((month, m) => {
      const rand = rng(1000 * (h + 1) + m);
      const clientsPass = Math.round(hotel.rooms * (13 + 5 * rand()));
      const clientsLongSejour = Math.round(hotel.rooms * (1 + 2 * rand()));
      const factor = params.longStayFactor[hotel.id] ?? 1;

      const deliveries: PilotDelivery[] = [];
      for (const product of params.products) {
        const key = `${hotel.id}|${month.key}|${product.code}`;
        const planned = COVERAGE_PLAN[key];
        if (planned === null) continue;
        const norm = normFor(params, product.code, hotel.id, month.key) ?? 0;
        const expected = cpra({ normPerClient: norm, nonUserRate: product.nonUserRate, clientsPass, clientsLongSejour, longStayFactor: factor });
        const ratio = planned ?? 0.97 + 0.08 * rand();
        const packet = PACKET_PLAN.has(key);
        const unit = packet ? "Paquet" : DELIVERY_UNIT[product.code]!;
        const unitFactor = params.conversions.find((c) => c.productCode === product.code && c.deliveryUnit === DELIVERY_UNIT[product.code])?.factor ?? 1;
        const quantity = Math.round((expected * ratio * 1000) / unitFactor) / 1000;
        // Two deliveries in the month, to show that CPRO is the sum of the lines.
        deliveries.push({ productCode: product.code, deliveryUnit: unit, quantity: Math.round(quantity * 0.6 * 1000) / 1000 }, { productCode: product.code, deliveryUnit: unit, quantity: Math.round(quantity * 0.4 * 1000) / 1000 });
      }

      const available = hotel.rooms * month.days;
      const occupancy = 0.58 + 0.2 * rand();
      const chambresVendues = Math.round(available * occupancy);
      const adr = Math.round((46_000 + 14_000 * rand()) / 500) * 500;
      const caChambres = chambresVendues * adr;
      const revenusTotaux = Math.round((caChambres * (1.22 + 0.1 * rand())) / 1000) * 1000;
      const cost = COST_RATIO[`${hotel.id}|${month.key}`] ?? 0.58 + 0.06 * rand();
      const charges = Math.round((revenusTotaux * cost) / 1000) * 1000;
      out[hotel.id]![month.key] = {
        population: { clientsPass, clientsLongSejour },
        deliveries,
        kpiInput: {
          chambresVendues,
          caChambres,
          revenusTotaux,
          chargesDepartementales: Math.round(charges * 0.7),
          chargesNonReparties: charges - Math.round(charges * 0.7),
          commissionsOta: Math.round(caChambres * (0.07 + 0.05 * rand())),
        },
      };
    });
  });
  return out;
}

/* ---------- Calcul (mêmes fonctions que le moteur réel) ---------- */

export interface EcartRow {
  productCode: string;
  productLabel: string;
  referenceUnit: ReferenceUnit;
  cpra: number;
  cpro: number | null;
  ecartVolume: number | null;
  couverturePct: number | null;
  ecartValorise: number | null;
  status: CoverageStatus;
  /** Unité de livraison sans facteur de conversion, quand c'est la cause du statut. */
  missingConversion?: string;
}

export interface HotelMonthResult {
  hotelId: string;
  monthKey: string;
  ecarts: EcartRow[];
  totalEcartValorise: number;
  kpis: HotelKpis;
  alerts: HotelAlert[];
  /** Structure des charges du mois, pour le graphique (FCFA). */
  structure: { chargesDepartementales: number; chargesNonReparties: number; gop: number };
  /** En mode `db` : un mois peut n'avoir que des écarts CPRO / CPRA, sans dépôt KPI. */
  hasKpis?: boolean;
}

export function computeHotelMonth(params: PilotParams, data: PilotMonthData, hotelId: string, monthKey: string, previous: { revpar: number | null; goppar: number | null } | null): HotelMonthResult {
  const hotel = pilotHotels.find((h) => h.id === hotelId)!;
  const month = PILOT_MONTHS.find((m) => m.key === monthKey)!;
  const factor = params.longStayFactor[hotelId] ?? 1;

  const ecarts = params.products.map<EcartRow>((product) => {
    const norm = normFor(params, product.code, hotelId, monthKey) ?? 0;
    const expected = cpra({ normPerClient: norm, nonUserRate: product.nonUserRate, clientsPass: data.population.clientsPass, clientsLongSejour: data.population.clientsLongSejour, longStayFactor: factor });
    const lines = data.deliveries
      .filter((d) => d.productCode === product.code)
      .map((d) => ({ quantite: d.quantity, facteur: params.conversions.find((c) => c.productCode === product.code && c.deliveryUnit === d.deliveryUnit)?.factor ?? null }));
    const delivered = cpro(lines);
    const result: ConsumableResult = consumableResult({ cpra: expected, cpro: delivered, coutUnitaire: product.unitCost }, DEFAULT_COVERAGE_BOUNDS);
    const missing = result.status === "CONVERSION_MANQUANTE" ? data.deliveries.find((d) => d.productCode === product.code && !params.conversions.find((c) => c.productCode === product.code && c.deliveryUnit === d.deliveryUnit && c.factor !== null))?.deliveryUnit : undefined;
    return { productCode: product.code, productLabel: product.label, referenceUnit: product.referenceUnit, cpra: result.cpra, cpro: result.cpro, ecartVolume: result.ecartVolume, couverturePct: result.couverturePct, ecartValorise: result.ecartValorise, status: result.status, missingConversion: missing };
  });

  const kpis = hotelKpis({ nombreChambres: hotel.rooms, jours: month.days, ...data.kpiInput });
  return {
    hotelId,
    monthKey,
    ecarts,
    totalEcartValorise: ecarts.reduce((sum, e) => sum + (e.ecartValorise ?? 0), 0),
    kpis,
    alerts: hotelAlerts(kpis, { previous }),
    structure: { chargesDepartementales: data.kpiInput.chargesDepartementales, chargesNonReparties: data.kpiInput.chargesNonReparties, gop: kpis.gop },
  };
}

/* ---------- État de la démo : paramètres, versions de calcul ---------- */

export interface ComputeVersion {
  version: number;
  at: string;
  by: string;
  note: string;
  params: PilotParams;
}

const FIRST_COMPUTE = "2026-10-01T06:00:00.000Z";

export const pilotState = {
  /** Brouillon édité dans l'écran des paramètres : n'a aucun effet sur les résultats avant un recalcul. */
  draft: initialParams(),
  versions: [{ version: 1, at: FIRST_COMPUTE, by: "Calcul automatique", note: "Premier calcul des 6 mois", params: initialParams() }] as ComputeVersion[],
};

export const monthDataFor = (params: PilotParams) => buildData(params);

/** Résultats d'une version de calcul pour tous les hôtels et tous les mois, avec comparaison au mois précédent. */
export function resultsFor(version: ComputeVersion): HotelMonthResult[] {
  // The deposits are fixed facts: they are built once from the first version's parameters.
  const data = monthDataFor(pilotState.versions[0]!.params);
  const out: HotelMonthResult[] = [];
  for (const hotel of pilotHotels) {
    let previous: { revpar: number | null; goppar: number | null } | null = null;
    for (const month of PILOT_MONTHS) {
      const result = computeHotelMonth(version.params, data[hotel.id]![month.key]!, hotel.id, month.key, previous);
      out.push(result);
      previous = { revpar: result.kpis.revpar, goppar: result.kpis.goppar };
    }
  }
  return out;
}
