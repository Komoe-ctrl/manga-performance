import { describe, expect, it } from "vitest";
import { TEMPLATES, getTemplate, templatesForSector, validateSubmission } from "../src/collection";
import type { InputRow, NormalizedRow, PeriodContext } from "../src/collection/types";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const OCTOBER: PeriodContext = { periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31) };
const row = (rowNumber: number, cells: InputRow["cells"]): InputRow => ({ rowNumber, cells });
const check = (id: string, input: Record<string, InputRow[]>, ctx: PeriodContext = OCTOBER) => validateSubmission(getTemplate(id)!, input, ctx);
const codes = (r: ReturnType<typeof check>) => r.errors.map((e) => e.code);

describe("registry", () => {
  it("holds the six V1 templates, versioned, with unique ids and unique keys per sheet", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["hotel_mensuel", "hotel_consommables_cpro", "resto_mensuel", "commerce_mensuel", "btp_chantiers", "tech_mensuel"]);
    for (const t of TEMPLATES) {
      expect(t.version).toBeGreaterThanOrEqual(1);
      for (const s of t.sheets) {
        const keys = s.columns.map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const c of s.columns) {
          if (c.kind === "enum") expect(c.options ?? c.optionsFrom).toBeTruthy();
          // The period is never typed by the user.
          expect(c.key.toLowerCase()).not.toMatch(/^(periode|period|mois)$/);
        }
      }
    }
    expect(getTemplate("nope")).toBeUndefined();
    expect(templatesForSector("HOTELLERIE").map((t) => t.id)).toEqual(["hotel_mensuel", "hotel_consommables_cpro"]);
    expect(templatesForSector("BTP")).toHaveLength(1);
  });

  it("names the sheets as the client's templates do", () => {
    expect(TEMPLATES.flatMap((t) => t.sheets.map((s) => s.name))).toEqual(["Saisie_Mensuelle", "Saisie_CPRO", "Population", "Saisie_Restaurant", "Saisie_Commerce", "Saisie_Chantiers", "Saisie_Tech", "Tresorerie"]);
  });
});

describe("hotel_mensuel", () => {
  const valid = { nombreChambres: 40, chambresVendues: 900, caChambres: 45_000_000, revenusTotaux: 60_000_000, chargesDepartementales: 25_000_000, chargesNonReparties: 12_000_000 };
  it("accepts a valid month; commissions are optional", () => {
    const r = check("hotel_mensuel", { Saisie_Mensuelle: [row(2, valid)] });
    expect(r.ok).toBe(true);
    expect(r.rows.Saisie_Mensuelle![0]).toMatchObject({ nombreChambres: 40, commissionsOta: null });
  });
  it("rejects more rooms sold than available, with the figure of the example in the avenant", () => {
    const r = check("hotel_mensuel", { Saisie_Mensuelle: [row(7, { ...valid, nombreChambres: 4, chambresVendues: 125 })] });
    expect(r.errors[0]!.message).toBe("Ligne 7, Chambres vendues (nuitées) : 125 est supérieur aux chambres disponibles (124).");
  });
  it("rejects total revenue below room revenue, zero rooms and a second line", () => {
    expect(codes(check("hotel_mensuel", { Saisie_Mensuelle: [row(2, { ...valid, revenusTotaux: 10 })] }))).toEqual(["CROSS_RULE"]);
    expect(codes(check("hotel_mensuel", { Saisie_Mensuelle: [row(2, { ...valid, nombreChambres: 0 })] }))).toContain("TOO_LOW");
    expect(codes(check("hotel_mensuel", { Saisie_Mensuelle: [row(2, valid), row(3, valid)] }))).toEqual(["TOO_MANY_ROWS"]);
  });
  it("has no GOP column: it is computed, never typed", () => {
    const keys = getTemplate("hotel_mensuel")!.sheets[0]!.columns.map((c) => c.key);
    expect(keys).not.toContain("gop");
  });
});

describe("resto_mensuel", () => {
  const valid = { caHt: 10_000_000, coutMatieres: 3_000_000, chargesPersonnel: 2_500_000, autresCharges: 2_000_000 };
  it("accepts a month without covers and rejects missing amounts or decimals", () => {
    expect(check("resto_mensuel", { Saisie_Restaurant: [row(2, valid)] }).ok).toBe(true);
    expect(check("resto_mensuel", { Saisie_Restaurant: [row(2, { ...valid, nombreCouverts: 1200 })] }).ok).toBe(true);
    expect(codes(check("resto_mensuel", { Saisie_Restaurant: [row(2, { ...valid, caHt: undefined })] }))).toEqual(["REQUIRED"]);
    expect(codes(check("resto_mensuel", { Saisie_Restaurant: [row(2, { ...valid, nombreCouverts: 10.5 })] }))).toEqual(["NOT_AN_INTEGER"]);
  });
  it("accepts a single line per establishment only", () => {
    expect(codes(check("resto_mensuel", { Saisie_Restaurant: [row(2, valid), row(3, valid)] }))).toEqual(["TOO_MANY_ROWS"]);
  });
});

describe("commerce_mensuel", () => {
  const valid = { caHt: 20_000_000, achats: 12_000_000, stockDebut: 5_000_000, stockFin: 6_000_000, chargesExploitation: 3_000_000 };
  it("accepts a valid month", () => {
    expect(check("commerce_mensuel", { Saisie_Commerce: [row(2, valid)] }).ok).toBe(true);
  });
  it("warns, without rejecting, when the opening stock differs from last month's closing stock", () => {
    const previous = { Saisie_Commerce: [{ ...valid, stockFin: 4_000_000 } as NormalizedRow] };
    const r = check("commerce_mensuel", { Saisie_Commerce: [row(2, valid)] }, { ...OCTOBER, previous });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: "STOCK_DISCONTINUITY", row: 2, column: "stockDebut" });
    expect(r.warnings[0]!.message).toContain("4 000 000");
  });
  it("stays silent when the stock continues, or when there is no previous month", () => {
    const same = { Saisie_Commerce: [{ ...valid, stockFin: 5_000_000 } as NormalizedRow] };
    expect(check("commerce_mensuel", { Saisie_Commerce: [row(2, valid)] }, { ...OCTOBER, previous: same }).warnings).toEqual([]);
    expect(check("commerce_mensuel", { Saisie_Commerce: [row(2, valid)] }).warnings).toEqual([]);
    expect(check("commerce_mensuel", { Saisie_Commerce: [row(2, valid)] }, { ...OCTOBER, previous: { Saisie_Commerce: [] } }).warnings).toEqual([]);
  });
});

describe("btp_chantiers", () => {
  const site = (code: string, over: Record<string, unknown> = {}) => ({
    codeChantier: code,
    nomChantier: `Chantier ${code}`,
    budgetInitial: 100_000_000,
    coutsReelsCumules: 40_000_000,
    avancementPhysique: 40,
    avancementFinancier: 35,
    caFacture: 45_000_000,
    prixMarche: 120_000_000,
    ...over,
  });
  it("accepts several sites in one file", () => {
    const r = check("btp_chantiers", { Saisie_Chantiers: [row(2, site("C-01")), row(3, site("C-02"))] });
    expect(r.ok).toBe(true);
    expect(r.rows.Saisie_Chantiers).toHaveLength(2);
  });
  it("rejects a repeated site code, a zero budget and a percentage above 100", () => {
    expect(codes(check("btp_chantiers", { Saisie_Chantiers: [row(2, site("C-01")), row(3, site("C-01"))] }))).toEqual(["DUPLICATE"]);
    expect(codes(check("btp_chantiers", { Saisie_Chantiers: [row(2, site("C-01", { budgetInitial: 0 }))] }))).toEqual(["TOO_LOW"]);
    expect(codes(check("btp_chantiers", { Saisie_Chantiers: [row(2, site("C-01", { avancementPhysique: 120 }))] }))).toEqual(["ABOVE_MAX"]);
    expect(codes(check("btp_chantiers", { Saisie_Chantiers: [row(2, site("C-01", { prixMarche: 0 }))] }))).toEqual(["TOO_LOW"]);
  });
  it("warns about falling costs or progress, and about a site that disappeared", () => {
    const previous = {
      Saisie_Chantiers: [
        { codeChantier: "C-01", coutsReelsCumules: 50_000_000, avancementPhysique: 60 },
        { codeChantier: "C-02", coutsReelsCumules: 1, avancementPhysique: 1 },
        { codeChantier: "C-GONE", coutsReelsCumules: 1, avancementPhysique: 1 },
      ] as NormalizedRow[],
    };
    const r = check("btp_chantiers", { Saisie_Chantiers: [row(2, site("C-01")), row(3, site("C-02")), row(4, site("C-NEW"))] }, { ...OCTOBER, previous });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(["COST_DECREASED", "PROGRESS_DECREASED", "SITE_MISSING"]);
    expect(r.warnings.find((w) => w.code === "SITE_MISSING")!.message).toBe("Chantier C-GONE non déclaré (terminé ?).");
    expect(r.warnings.find((w) => w.code === "COST_DECREASED")).toMatchObject({ row: 2, column: "coutsReelsCumules" });
  });
  it("does not warn when there is no previous month", () => {
    expect(check("btp_chantiers", { Saisie_Chantiers: [row(2, site("C-01"))] }).warnings).toEqual([]);
    expect(check("btp_chantiers", { Saisie_Chantiers: [row(2, site("C-01"))] }, { ...OCTOBER, previous: { Saisie_Chantiers: [] } }).warnings).toEqual([]);
  });
});

describe("tech_mensuel", () => {
  const segment = (name: string, over: Record<string, unknown> = {}) => ({
    segment: name,
    mrrDebut: 10_000_000,
    mrrFin: 11_000_000,
    mrrPerdu: 500_000,
    clientsDebut: 200,
    clientsPerdus: 8,
    nouveauxClients: 20,
    depensesAcquisition: 2_000_000,
    ...over,
  });
  const treasury = { encaissementsTotaux: 12_000_000, decaissementsTotaux: 15_000_000, tresorerieFin: 30_000_000 };
  it("validates two sheets together", () => {
    const r = check("tech_mensuel", { Saisie_Tech: [row(2, segment("App")), row(3, segment("API"))], Tresorerie: [row(2, treasury)] });
    expect(r.ok).toBe(true);
  });
  it("accepts negative cash on the company sheet but not negative MRR", () => {
    expect(check("tech_mensuel", { Saisie_Tech: [row(2, segment("App"))], Tresorerie: [row(2, { ...treasury, tresorerieFin: -2_000_000 })] }).ok).toBe(true);
    expect(codes(check("tech_mensuel", { Saisie_Tech: [row(2, segment("App", { mrrFin: -1 }))], Tresorerie: [row(2, treasury)] }))).toEqual(["BELOW_MIN"]);
  });
  it("rejects lost MRR or lost clients above the opening figures, and a repeated segment", () => {
    expect(codes(check("tech_mensuel", { Saisie_Tech: [row(2, segment("App", { mrrPerdu: 20_000_000 }))], Tresorerie: [row(2, treasury)] }))).toEqual(["CROSS_RULE"]);
    expect(codes(check("tech_mensuel", { Saisie_Tech: [row(2, segment("App", { clientsPerdus: 201 }))], Tresorerie: [row(2, treasury)] }))).toEqual(["CROSS_RULE"]);
    expect(codes(check("tech_mensuel", { Saisie_Tech: [row(2, segment("App")), row(3, segment("app"))], Tresorerie: [row(2, treasury)] }))).toEqual(["DUPLICATE"]);
  });
  it("requires the transaction revenue when the TPV is filled, and rejects a missing treasury sheet", () => {
    expect(codes(check("tech_mensuel", { Saisie_Tech: [row(2, segment("App", { tpv: 90_000_000 }))], Tresorerie: [row(2, treasury)] }))).toEqual(["REQUIRED"]);
    expect(codes(check("tech_mensuel", { Saisie_Tech: [row(2, segment("App"))] }))).toEqual(["SHEET_MISSING"]);
  });
});

describe("hotel_consommables_cpro (+ Population)", () => {
  const ctx: PeriodContext = {
    ...OCTOBER,
    options: {
      produits: ["Gel douche", "Papier toilette", "Javel"],
      unites: { "Gel douche": ["bidon 4 L", "litre"], "Papier toilette": ["paquet"], Javel: ["bidon 20 L"] },
    },
  };
  const line = (n: number, over: Record<string, unknown> = {}) => row(n, { produit: "Gel douche", uniteLivraison: "litre", quantite: 12.5, dateLivraison: "05/10/2026", numeroBon: "BL-001", ...over });
  const population = row(2, { clientsTotal: 100, clientsPass: 80, clientsLongSejour: 20 });

  it("accepts one line per delivery and the population in the same file", () => {
    const r = check("hotel_consommables_cpro", { Saisie_CPRO: [line(2), line(3, { produit: "Papier toilette", uniteLivraison: "paquet", numeroBon: "BL-002" }), line(4, { produit: "Javel", uniteLivraison: "bidon 20 L", numeroBon: "BL-003" })], Population: [population] }, ctx);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.rows.Saisie_CPRO![0]).toMatchObject({ produit: "Gel douche", quantite: 12.5, dateLivraison: "2026-10-05" });
  });
  it("rejects a cell holding several dates, as in « 02,12,14,15,16/10 »", () => {
    const r = check("hotel_consommables_cpro", { Saisie_CPRO: [line(2, { dateLivraison: "02,12,14,15,16/10" })], Population: [population] }, ctx);
    expect(codes(r)).toEqual(["INVALID_DATE"]);
  });
  it("rejects a date outside the period, a zero quantity and a unit that does not belong to the product", () => {
    expect(codes(check("hotel_consommables_cpro", { Saisie_CPRO: [line(2, { dateLivraison: "02/11/2026" })], Population: [population] }, ctx))).toEqual(["DATE_OUT_OF_PERIOD"]);
    expect(codes(check("hotel_consommables_cpro", { Saisie_CPRO: [line(2, { quantite: 0 })], Population: [population] }, ctx))).toEqual(["TOO_LOW"]);
    expect(codes(check("hotel_consommables_cpro", { Saisie_CPRO: [line(2, { uniteLivraison: "paquet" })], Population: [population] }, ctx))).toEqual(["NOT_IN_LIST"]);
  });
  it("warns about a repeated delivery note for the same product, not for another product", () => {
    const r = check("hotel_consommables_cpro", { Saisie_CPRO: [line(2), line(3), line(4, { produit: "Javel", uniteLivraison: "bidon 20 L" })], Population: [population] }, ctx);
    expect(r.ok).toBe(true);
    expect(r.warnings.filter((w) => w.code === "DUPLICATE")).toHaveLength(1);
  });
  it("warns about an expected product without any delivery, without rejecting", () => {
    const r = check("hotel_consommables_cpro", { Saisie_CPRO: [line(2)], Population: [population] }, ctx);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.message)).toEqual(["Aucune livraison déclarée pour Papier toilette.", "Aucune livraison déclarée pour Javel."]);
  });
  it("gives no missing-delivery warning when every expected product was delivered, and errors without configuration", () => {
    const odd: PeriodContext = { ...OCTOBER, options: { produits: ["Gel douche"], unites: { "Gel douche": ["litre"] } } };
    expect(check("hotel_consommables_cpro", { Saisie_CPRO: [line(2)], Population: [population] }, odd).warnings).toEqual([]);
    const none = check("hotel_consommables_cpro", { Saisie_CPRO: [line(2)], Population: [population] }, OCTOBER);
    expect(codes(none)).toEqual(["OPTIONS_UNAVAILABLE", "OPTIONS_UNAVAILABLE"]);
  });
  it("rejects a total that is not PASS + long stay", () => {
    const r = check("hotel_consommables_cpro", { Saisie_CPRO: [line(2)], Population: [row(2, { clientsTotal: 101, clientsPass: 80, clientsLongSejour: 20 })] }, ctx);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ sheet: "Population", code: "CROSS_RULE", message: "Ligne 2, Clients total : 101 ne correspond pas à la somme des clients PASS et long séjour (100)." });
  });
  it("rejects the file when the population sheet is missing", () => {
    expect(codes(check("hotel_consommables_cpro", { Saisie_CPRO: [line(2)] }, ctx))).toEqual(["SHEET_MISSING"]);
  });
});
