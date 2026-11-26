import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hotelAlerts, hotelKpis } from "@manga/core/kpi/hotel";
import { describe, expect, it } from "vitest";
import { aggregate, periods, variances } from "@/lib/demo/compute";
import { demoHotelInput, demoHotelReading } from "@/lib/demo/hotel-kpis";
import { COST_POSTS, DEMO_HOTELS, DEMO_MONTHS, DEMO_ROOMS, demoDashboard } from "@/lib/mock/demo-dashboard";
import { collectionEntities } from "@/lib/mock/collection";
import { demoConsumables, PILOT_MONTHS } from "@/lib/mock/pilot";
import { formatDelta } from "@/lib/utils/delta";

const source = { months: [...DEMO_MONTHS], ...demoDashboard };
const last = (n: number) => DEMO_MONTHS.slice(-n);

describe("the public demo shows the client's hotel indicators (recette B3)", () => {
  it("talks about the same three hotels as the pilot and the collection", () => {
    const hotels = collectionEntities.filter((e) => e.sector === "HOTELLERIE");
    expect(DEMO_HOTELS.map((h) => ({ id: h.id, name: h.name }))).toEqual(hotels.map((h) => ({ id: h.id, name: h.name })));
    for (const h of DEMO_HOTELS) expect(DEMO_ROOMS[h.id]).toBeGreaterThan(0);
  });

  it("computes RevPAR, TRevPAR, GOP, GOPPAR, GOP Margin, occupancy and ADR with the client's functions", () => {
    for (const hotel of ["all", ...DEMO_HOTELS.map((h) => h.id)]) {
      for (const months of [last(1), last(3), last(12)]) {
        const input = demoHotelInput(source, hotel, months);
        const kpis = demoHotelReading(source, hotel, months, DEMO_MONTHS.slice(-months.length * 2, -months.length)).kpis;
        expect(kpis).toEqual(hotelKpis(input));

        const rooms = hotel === "all" ? Object.values(DEMO_ROOMS).reduce((a, b) => a + b, 0) : DEMO_ROOMS[hotel]!;
        expect(kpis.chambresDisponibles).toBe(rooms * input.jours);
        expect(kpis.gop).toBe(input.revenusTotaux - input.chargesDepartementales - input.chargesNonReparties);
        expect(kpis.revpar).toBeCloseTo(input.caChambres / kpis.chambresDisponibles, 6);
        expect(kpis.trevpar).toBeCloseTo(input.revenusTotaux / kpis.chambresDisponibles, 6);
        expect(kpis.goppar).toBeCloseTo(kpis.gop / kpis.chambresDisponibles, 6);
        expect(kpis.adr).toBeCloseTo(input.caChambres / input.chambresVendues, 6);
        // Plausible, consistent figures: nothing above full occupancy, TRevPAR never below RevPAR.
        expect(kpis.tauxOccupationPct).toBeGreaterThan(40);
        expect(kpis.tauxOccupationPct).toBeLessThan(95);
        expect(kpis.trevpar!).toBeGreaterThanOrEqual(kpis.revpar!);
      }
    }
  });

  it("splits the costs the USALI way and agrees with the screen's own margin", () => {
    const months = last(3);
    const input = demoHotelInput(source, "all", months);
    const screen = aggregate(source, { hotelId: "all", productId: "all" }, months);
    expect(input.chargesDepartementales + input.chargesNonReparties).toBe(screen.charges);
    expect(input.revenusTotaux).toBe(screen.revenue);
    expect(hotelKpis(input).gopMarginPct).toBeCloseTo(screen.marginRate, 6);
  });

  it("gives the avenant's alerts from the same rules as the consultant's screens", () => {
    for (const hotel of ["all", ...DEMO_HOTELS.map((h) => h.id)]) {
      const reading = demoHotelReading(source, hotel, last(3), DEMO_MONTHS.slice(-6, -3));
      expect(reading.alerts).toEqual(hotelAlerts(reading.kpis, { previous: reading.previous }));
      for (const alert of reading.alerts) expect(["GOP_MARGIN_LOW", "GOP_MARGIN_WATCH", "PROFIT_VS_REVPAR", "COSTS_OUTPACE", "ANNEXES_STRONG"]).toContain(alert.code);
    }
  });

  it("shows the consumables gaps for the three hotels over the six last closed months, with coloured statuses", () => {
    const data = demoConsumables();
    expect(data.hotels).toHaveLength(3);
    expect(data.months.map((m) => m.key)).toEqual(PILOT_MONTHS.map((m) => m.key));
    expect(data.results).toHaveLength(18);
    const statuses = new Set(data.results.flatMap((r) => r.ecarts.map((e) => e.status)));
    for (const status of ["CONFORME", "SUR", "SOUS", "CPRO_MANQUANT", "CONVERSION_MANQUANTE"]) expect(statuses.has(status as never), status).toBe(true);
    // The demo never moves with what the consultant edits in the back-office demonstration.
    expect(JSON.stringify(demoConsumables())).toBe(JSON.stringify(data));
  });
});

describe("variations are in points for ratios and in percent for amounts (recette C1, started here)", () => {
  it("writes points for a rate", () => {
    expect(formatDelta("ratio", 31.1, 32)).toMatchObject({ text: "−0,9 pt", direction: "down" });
    expect(formatDelta("ratio", 32.5, 31.4)).toMatchObject({ text: "+1,1 pt", direction: "up" });
    expect(formatDelta("ratio", 40, 40)).toMatchObject({ text: "0,0 pt", direction: "flat" });
  });

  it("writes percent for an amount", () => {
    expect(formatDelta("amount", 110, 100)).toMatchObject({ text: "+10,0 %", direction: "up" });
    expect(formatDelta("amount", 90, 100)).toMatchObject({ text: "−10,0 %", direction: "down" });
    expect(formatDelta("amount", -50, -100)).toMatchObject({ direction: "up" }); // less negative is an improvement
  });

  it("says nothing when it cannot compare, instead of inventing a variation", () => {
    expect(formatDelta("amount", 10, 0)).toBeNull();
    expect(formatDelta("amount", null, 5)).toBeNull();
    expect(formatDelta("ratio", 5, undefined)).toBeNull();
    expect(formatDelta("ratio", Number.NaN, 5)).toBeNull();
    expect(formatDelta("ratio", 0, 0)).toMatchObject({ direction: "flat" }); // a ratio at zero is still comparable
  });
});

describe("the public demo uses the budget / actual vocabulary only (recette B4)", () => {
  it("names the budget gaps « budget » and « réalisé », never CPRO / CPRA", () => {
    const gaps = variances({ ...source, costPosts: COST_POSTS }, { hotelId: "all", productId: "all" }, periods(source.months, "trimestre").current);
    for (const g of gaps) {
      expect(Object.keys(g)).toEqual(expect.arrayContaining(["budget", "actual", "gap", "gapPct"]));
      expect(Object.keys(g)).not.toEqual(expect.arrayContaining(["cpro"]));
      expect(g.gap).toBe(g.actual - g.budget);
    }
  });

  const files = ["components/demo/demo-dashboard.tsx", "components/demo/demo-sections.tsx", "components/demo/hotel-kpis.tsx", "components/demo/sector-demo.tsx", "lib/demo/compute.ts", "lib/demo/insights.ts", "lib/demo/sector-views.ts", "server/exports/demo.ts"];
  const read = (file: string) => readFileSync(resolve(import.meta.dirname, "../src", file), "utf8");

  it("shows no provisional wording and no unvalidated indicator in the public demo", () => {
    for (const file of files) {
      const text = read(file);
      expect(text, `${file} mentions « provisoire »`).not.toMatch(/provisoire/i);
      expect(text, `${file} mentions « à confirmer »`).not.toMatch(/à confirmer/i);
      expect(text, `${file} still has the break-even or coverage-rate indicators`).not.toMatch(/point mort|breakEven|taux de couverture|coverageRate/i);
      expect(text, `${file} uses the old budget wording`).not.toMatch(/prévisionnel contre pratiqué/i);
    }
  });

  it("keeps CPRO and CPRA for consumables only", () => {
    for (const file of files) {
      for (const line of read(file).split("\n").filter((l) => /\bCPR[OA]\b|CPro|CPra/.test(l))) {
        expect(line, `${file}: « ${line.trim()} » uses CPRO / CPRA outside consumables`).toMatch(/consommable|livré|théorique|couverture|norme|sur-distribution|Consommables|CPRO ÷ CPRA|CPRO \/ CPRA/i);
      }
    }
  });
});
