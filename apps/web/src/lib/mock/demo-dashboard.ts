import { createRng } from "./random";

export const DEMO_HOTELS = [
  { id: "h1", name: "Hôtel Lagune Ivoire (Cocody)" },
  { id: "h2", name: "Résidence Les Palmes (Marcory)" },
  { id: "h3", name: "Hôtel Baie de San-Pédro" },
] as const;

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
  /** Coûts par poste : prévu (CPro) et pratiqué (CPra). */
  costs: Record<CostPostId, { planned: number; actual: number }>;
}

export interface DemoHotelMonth {
  hotelId: string;
  month: string;
  staff: number;
  satisfaction: number; // sur 5
}

/** 24 mois glissants se terminant en oct. 2026. */
export const DEMO_MONTHS: string[] = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 10 + i, 1));
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
  const records: DemoRecord[] = [];
  const hotelMonths: DemoHotelMonth[] = [];
  DEMO_HOTELS.forEach((hotel, hi) => {
    DEMO_MONTHS.forEach((month, mi) => {
      const season = 1 + 0.15 * Math.sin((mi / 12) * 2 * Math.PI) + mi * 0.004;
      hotelMonths.push({
        hotelId: hotel.id,
        month,
        staff: 38 + hi * 6 + rng.int(-2, 2),
        satisfaction: Math.round((4 + rng.next() * 0.7 - hi * 0.1) * 10) / 10,
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
