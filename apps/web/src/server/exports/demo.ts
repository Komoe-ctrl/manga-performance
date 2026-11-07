import { z } from "zod";
import { aggregate, monthlySeries, periods, variances, type Granularity } from "@/lib/demo/compute";
import { actionPlan, buildInsights, hotelSummary } from "@/lib/demo/insights";
import { COST_POSTS, DEMO_HOTELS, DEMO_MONTHS, DEMO_PRODUCTS, demoDashboard } from "@/lib/mock/demo-dashboard";
import { ExportError, type ExportTable } from "./types";

const GRANULARITY_LABELS: Record<Granularity, string> = { mois: "Dernier mois", trimestre: "Dernier trimestre", annee: "Dernière année" };

const filterSchema = z.object({
  hotelId: z.enum(["all", ...DEMO_HOTELS.map((h) => h.id)]).default("all"),
  productId: z.enum(["all", ...DEMO_PRODUCTS.map((p) => p.id)]).default("all"),
  granularity: z.enum(["mois", "trimestre", "annee"]).default("trimestre"),
});

export function parseDemoFilters(params: URLSearchParams) {
  const parsed = filterSchema.safeParse({
    hotelId: params.get("hotelId") ?? undefined,
    productId: params.get("productId") ?? undefined,
    granularity: params.get("granularity") ?? undefined,
  });
  if (!parsed.success) throw new ExportError("INVALID", "Filtres invalides.");
  return parsed.data;
}

const percent = (value: number) => `${value.toFixed(1).replace(".", ",")} %`;

/**
 * Export of the demonstration dashboard, from the same fictitious dataset and the same formulas
 * as the screen (`lib/demo/compute.ts`): twelve months of revenue, charges and margin for the
 * selected hotel and product, and the cost variances over the selected period.
 */
export function buildDemoExport(filters: z.output<typeof filterSchema>): ExportTable {
  const source = { months: [...DEMO_MONTHS], ...demoDashboard };
  const hotel = DEMO_HOTELS.find((h) => h.id === filters.hotelId)?.name ?? "Tous les hôtels";
  const product = DEMO_PRODUCTS.find((p) => p.id === filters.productId)?.name ?? "Tous les produits";
  const period = periods(source.months, filters.granularity).current;
  const current = aggregate(source, filters, period);

  const monthly = monthlySeries(source, filters);
  const gaps = variances({ ...source, costPosts: COST_POSTS }, filters, period);
  const previous = aggregate(source, filters, periods(source.months, filters.granularity).previous);
  const summary = hotelSummary({ ...source, hotels: DEMO_HOTELS }, filters.productId, period);
  const insights = buildInsights({ cur: current, prev: previous, gaps, hotels: summary, scopeIsAllHotels: filters.hotelId === "all" });
  const actions = actionPlan(gaps);

  return {
    slug: "demo-dashboard",
    title: "Dashboard de démonstration",
    filterSummary: [
      "Données fictives, exemple de livrable MANGA PERFORMANCE",
      `Hôtel : ${hotel}`,
      `Produit : ${product}`,
      `Période : ${GRANULARITY_LABELS[filters.granularity]}`,
      `Sur la période : marge brute ${percent(current.marginRate)}, CA ${Math.round(current.revenue)} FCFA, charges ${Math.round(current.charges)} FCFA`,
      ...gaps.map((g) => `Écart ${g.post} : ${Math.round(g.gap)} FCFA (${percent(g.gapPct)})`),
      ...insights.map((i) => `Lecture : ${i.title}. ${i.detail}`),
      ...actions.map((a) => `Action ${a.priority} (${a.post}) : ${a.action}`),
    ],
    columns: [
      { header: "Mois", width: 2 },
      { header: "Chiffre d'affaires (FCFA)", width: 3, type: "money" },
      { header: "Charges réelles (FCFA)", width: 3, type: "money" },
      { header: "Marge brute", width: 2 },
    ],
    rows: monthly.map((m) => [m.month, Math.round(m.ca), Math.round(m.charges), percent(m.marge)]),
  };
}
