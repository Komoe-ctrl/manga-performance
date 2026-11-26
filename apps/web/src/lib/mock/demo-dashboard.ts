import { REFERENCE_DATE } from "@/lib/constants";
import { createRng } from "./random";

/**
 * Les trois hôtels fictifs sont ceux du pilote et de la collecte (mêmes identifiants, mêmes noms) : la démo publique et
 * l'espace du consultant parlent des mêmes établissements. Un test garde les deux listes alignées.
 */
export const DEMO_HOTELS = [
  { id: "ce-1", name: "Hôtel Les Cocotiers" },
  { id: "ce-2", name: "Hôtel Baie Sereine" },
  { id: "ce-3", name: "Hôtel Cap Lumière" },
] as const;

/** Nombre de chambres de chaque hôtel fictif. */
export const DEMO_ROOMS: Record<string, number> = { "ce-1": 52, "ce-2": 44, "ce-3": 32 };

export const DEMO_PRODUCTS = [
  { id: "chambres", name: "Chambres" },
  { id: "restauration", name: "Restauration" },
  { id: "seminaires", name: "Séminaires" },
] as const;

export const COST_POSTS = [
  { id: "personnel", name: "Personnel", share: 0.38 },
  { id: "achats", name: "Achats", share: 0.27 },
  { id: "energie", name: "Énergie", share: 0.12 },
  { id: "entretien", name: "Entretien", share: 0.1 },
  { id: "marketing", name: "Marketing", share: 0.05 },
  { id: "autres", name: "Autres charges", share: 0.08 },
] as const;

export type CostPostId = (typeof COST_POSTS)[number]["id"];

export interface DemoRecord {
  hotelId: string;
  productId: string;
  month: string; // YYYY-MM
  revenue: number;
  /** Coûts par poste : budget (`planned`) et réalisé (`actual`). */
  costs: Record<CostPostId, { planned: number; actual: number }>;
}

export interface DemoHotelMonth {
  hotelId: string;
  month: string;
  staff: number;
  satisfaction: number; // sur 5
  /** Chambres vendues dans le mois (le taux d'occupation et l'ADR en découlent). */
  roomsSold: number;
}

/** 24 mois glissants : les 24 derniers mois clos à partir d'aujourd'hui. */
export const DEMO_MONTHS: string[] = Array.from({ length: 24 }, (_, i) => {
  const today = new Date(REFERENCE_DATE);
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 24 + i, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
});

const BASE_REVENUE: Record<string, number> = {
  chambres: 48_000_000,
  restauration: 16_000_000,
  seminaires: 7_000_000,
};
const HOTEL_FACTOR = [1.15, 0.9, 0.7];

function build() {
  const rng = createRng(404);
  const occupancyRng = createRng(909);
  const records: DemoRecord[] = [];
  const hotelMonths: DemoHotelMonth[] = [];
  DEMO_HOTELS.forEach((hotel, hi) => {
    DEMO_MONTHS.forEach((month, mi) => {
      const season = 1 + 0.15 * Math.sin((mi / 12) * 2 * Math.PI) + mi * 0.004;
      const [year, monthNumber] = month.split("-").map(Number);
      const available = DEMO_ROOMS[hotel.id]! * new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
      hotelMonths.push({
        hotelId: hotel.id,
        month,
        staff: 38 + hi * 6 + rng.int(-2, 2),
        satisfaction: Math.round((4 + rng.next() * 0.7 - hi * 0.1) * 10) / 10,
        // Own generator: adding the occupancy never moves the revenue and cost figures drawn above.
        roomsSold: Math.round(available * (0.64 + 0.1 * Math.sin((mi / 12) * 2 * Math.PI) + 0.12 * occupancyRng.next() - hi * 0.02)),
      });
      DEMO_PRODUCTS.forEach((product) => {
        const revenue = Math.round(BASE_REVENUE[product.id] * HOTEL_FACTOR[hi] * season * (0.92 + rng.next() * 0.16));
        const plannedTotal = revenue * (0.7 + rng.next() * 0.04);
        const costs = {} as DemoRecord["costs"];
        for (const post of COST_POSTS) {
          const planned = Math.round(plannedTotal * post.share);
          costs[post.id] = { planned, actual: Math.round(planned * (0.94 + rng.next() * 0.2)) };
        }
        records.push({ hotelId: hotel.id, productId: product.id, month, revenue, costs });
      });
    });
  });
  return { records, hotelMonths };
}

export const demoDashboard = build();
