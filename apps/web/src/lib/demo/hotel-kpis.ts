import { hotelAlerts, hotelKpis, type HotelAlert, type HotelInput, type HotelKpis } from "@manga/core/kpi/hotel";
import type { DemoHotelMonth, DemoRecord } from "@/lib/mock/demo-dashboard";
import { DEMO_ROOMS } from "@/lib/mock/demo-dashboard";

/*
 * KPI hôteliers de la démonstration publique : les fonctions du client (`@manga/core/kpi/hotel`), appliquées aux
 * données fictives. Mêmes formules et mêmes seuils d'alerte que l'espace du consultant (avenant n°1, §11.2 et §11 bis).
 */

interface Source {
  records: DemoRecord[];
  hotelMonths: DemoHotelMonth[];
}

/** Charges départementales (personnel, achats) ; tout le reste est non réparti (énergie, entretien, marketing, autres). */
const DEPARTMENTAL = new Set(["personnel", "achats"]);

const daysIn = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, m!, 0)).getUTCDate();
};

/** Entrées d'un hôtel (ou de tous) sur des mois : les chambres disponibles sont chambres × jours. */
export function demoHotelInput(src: Source, hotelId: string, months: string[]): HotelInput {
  const set = new Set(months);
  const inScope = (id: string) => hotelId === "all" || id === hotelId;
  const records = src.records.filter((r) => set.has(r.month) && inScope(r.hotelId));
  const rooms = hotelId === "all" ? Object.values(DEMO_ROOMS).reduce((a, b) => a + b, 0) : (DEMO_ROOMS[hotelId] ?? 0);

  let chargesDepartementales = 0;
  let chargesNonReparties = 0;
  for (const r of records) {
    for (const [post, cost] of Object.entries(r.costs)) {
      if (DEPARTMENTAL.has(post)) chargesDepartementales += cost.actual;
      else chargesNonReparties += cost.actual;
    }
  }
  return {
    nombreChambres: rooms,
    jours: months.reduce((sum, m) => sum + daysIn(m), 0),
    chambresVendues: src.hotelMonths.filter((h) => set.has(h.month) && inScope(h.hotelId)).reduce((s, h) => s + h.roomsSold, 0),
    caChambres: records.filter((r) => r.productId === "chambres").reduce((s, r) => s + r.revenue, 0),
    revenusTotaux: records.reduce((s, r) => s + r.revenue, 0),
    chargesDepartementales,
    chargesNonReparties,
  };
}

export interface DemoHotelReading {
  kpis: HotelKpis;
  previous: HotelKpis;
  alerts: HotelAlert[];
}

/** KPI de la période, de la période précédente, et alertes du §11 bis (le consultant lit, le client ne reçoit pas d'alerte). */
export function demoHotelReading(src: Source, hotelId: string, current: string[], previous: string[]): DemoHotelReading {
  const kpis = hotelKpis(demoHotelInput(src, hotelId, current));
  const before = hotelKpis(demoHotelInput(src, hotelId, previous));
  return { kpis, previous: before, alerts: hotelAlerts(kpis, { previous: before }) };
}
