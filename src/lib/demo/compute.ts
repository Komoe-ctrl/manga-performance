import type { CostPostId, DemoHotelMonth, DemoRecord } from "@/lib/services";

export type Granularity = "mois" | "trimestre" | "annee";
export const PERIOD_MONTHS: Record<Granularity, number> = { mois: 1, trimestre: 3, annee: 12 };

export interface Filters {
  hotelId: string; // "all" ou id
  productId: string; // "all" ou id
  granularity: Granularity;
}

interface Source {
  months: string[];
  records: DemoRecord[];
  hotelMonths: DemoHotelMonth[];
}

const sumCosts = (r: DemoRecord, key: "planned" | "actual") =>
  Object.values(r.costs).reduce((s, c) => s + c[key], 0);

export function aggregate(src: Source, f: Pick<Filters, "hotelId" | "productId">, months: string[]) {
  const set = new Set(months);
  const records = src.records.filter(
    (r) => set.has(r.month) && (f.hotelId === "all" || r.hotelId === f.hotelId) && (f.productId === "all" || r.productId === f.productId),
  );
  const hm = src.hotelMonths.filter((h) => set.has(h.month) && (f.hotelId === "all" || h.hotelId === f.hotelId));

  const revenue = records.reduce((s, r) => s + r.revenue, 0);
  const charges = records.reduce((s, r) => s + sumCosts(r, "actual"), 0);
  const planned = records.reduce((s, r) => s + sumCosts(r, "planned"), 0);

  // effectif moyen par hôtel sur la période, puis somme des hôtels
  const staffByHotel = new Map<string, number[]>();
  hm.forEach((h) => staffByHotel.set(h.hotelId, [...(staffByHotel.get(h.hotelId) ?? []), h.staff]));
  const staff = [...staffByHotel.values()].reduce((s, a) => s + a.reduce((x, y) => x + y, 0) / a.length, 0);
  const satisfaction = hm.length ? hm.reduce((s, h) => s + h.satisfaction, 0) / hm.length : 0;

  // TODO: formules du point mort et du taux de couverture à confirmer par le client.
  // Hypothèse provisoire : 60 % des charges sont fixes, 40 % variables.
  const fixed = charges * 0.6;
  const variableRatio = revenue ? (charges * 0.4) / revenue : 0;
  const breakEven = variableRatio < 1 ? fixed / (1 - variableRatio) : 0;
  const reachedShare = revenue ? breakEven / revenue : 0; // part de la période nécessaire pour l'atteindre

  return {
    revenue,
    charges,
    planned,
    marginRate: revenue ? ((revenue - charges) / revenue) * 100 : 0,
    revenuePerStaff: staff ? revenue / staff : 0,
    satisfaction,
    breakEven,
    breakEvenReached: reachedShare <= 1,
    breakEvenDays: Math.round(reachedShare * months.length * 30),
    coverageRate: charges ? (revenue / charges) * 100 : 0, // TODO: formule à confirmer
  };
}

export function periods(allMonths: string[], g: Granularity) {
  const n = PERIOD_MONTHS[g];
  return {
    current: allMonths.slice(-n),
    previous: allMonths.slice(-2 * n, -n),
  };
}

/** Variation en % (ou en points pour les taux). */
export const variation = (cur: number, prev: number) => (prev ? ((cur - prev) / prev) * 100 : 0);

export function monthlySeries(src: Source, f: Pick<Filters, "hotelId" | "productId">) {
  return src.months.slice(-12).map((m) => {
    const a = aggregate(src, f, [m]);
    return { month: m, ca: a.revenue, charges: a.charges, marge: Math.round(a.marginRate * 10) / 10 };
  });
}

export function byHotel(src: Source & { hotels: readonly { id: string; name: string }[] }, productId: string, months: string[]) {
  return src.hotels.map((h) => {
    const a = aggregate(src, { hotelId: h.id, productId }, months);
    return { hotel: h.name, ca: a.revenue, charges: a.charges };
  });
}

export function variances(
  src: Source & { costPosts: readonly { id: CostPostId; name: string }[] },
  f: Pick<Filters, "hotelId" | "productId">,
  months: string[],
) {
  const set = new Set(months);
  const records = src.records.filter(
    (r) => set.has(r.month) && (f.hotelId === "all" || r.hotelId === f.hotelId) && (f.productId === "all" || r.productId === f.productId),
  );
  return src.costPosts.map((p) => {
    const cpro = records.reduce((s, r) => s + r.costs[p.id].planned, 0);
    const cpra = records.reduce((s, r) => s + r.costs[p.id].actual, 0);
    return { post: p.name, cpro, cpra, gap: cpra - cpro, gapPct: cpro ? ((cpra - cpro) / cpro) * 100 : 0 };
  });
}
