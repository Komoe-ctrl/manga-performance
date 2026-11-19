import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTemplate, type PeriodContext } from "@manga/core/collection";
import { createTemplateService } from "@/server/collection/template-service";
import { buildTemplateWorkbook, MAX_ENTRY_ROWS } from "@/server/collection/template-xlsx";
import { checkWorkbook } from "@/server/collection/workbook-check";
import { createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";

const SECRET = "test-secret-test-secret-test-secret-1234";
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const PERIOD = { id: "period-oct", start: day(2026, 10, 1), end: day(2026, 10, 31), dueAt: day(2026, 11, 3) };
const CTX: PeriodContext = { periodStart: PERIOD.start, periodEnd: PERIOD.end };
const ENTITY = { id: "entity-1", name: "Hôtel Lagune" };

const build = (templateId: string, over: Partial<Parameters<typeof buildTemplateWorkbook>[0]> = {}) =>
  buildTemplateWorkbook({ template: getTemplate(templateId)!, entity: ENTITY, period: PERIOD, secret: SECRET, ...over });

async function open(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}
async function fill(buffer: Buffer, edit: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = await open(buffer);
  edit(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const check = (buffer: Buffer, templateId: string, over: { entityId?: string; periodId?: string; secret?: string; ctx?: PeriodContext } = {}) =>
  checkWorkbook({ buffer, template: getTemplate(templateId)!, expected: { entityId: over.entityId ?? ENTITY.id, periodId: over.periodId ?? PERIOD.id }, ctx: over.ctx ?? CTX, secret: over.secret ?? SECRET });

const HOTEL_ROW = { A: 40, B: 900, C: 45_000_000, D: 60_000_000, E: 25_000_000, F: 12_000_000 };
const fillHotel = (wb: ExcelJS.Workbook, values: Partial<typeof HOTEL_ROW> = {}) => {
  const ws = wb.getWorksheet("Saisie_Mensuelle")!;
  Object.entries({ ...HOTEL_ROW, ...values }).forEach(([col, v]) => (ws.getCell(`${col}2`).value = v));
};

describe("generated workbook", () => {
  it("has the entry sheet, the instructions, and hidden technical sheets", async () => {
    const wb = await open(await build("hotel_mensuel"));
    const states = Object.fromEntries(wb.worksheets.map((w) => [w.name, w.state]));
    expect(states).toMatchObject({ Saisie_Mensuelle: "visible", Instructions: "visible", _meta: "veryHidden", _lists: "veryHidden" });
  });

  it("puts the headers in row 1, frozen and locked, with data cells unlocked", async () => {
    const wb = await open(await build("hotel_mensuel"));
    const ws = wb.getWorksheet("Saisie_Mensuelle")!;
    expect(ws.getRow(1).values).toEqual([undefined, ...getTemplate("hotel_mensuel")!.sheets[0]!.columns.map((c) => c.label)]);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.getCell("A1").protection?.locked).not.toBe(false);
    expect(ws.getCell("A2").protection?.locked).toBe(false);
    expect((ws as unknown as { sheetProtection?: unknown }).sheetProtection).toBeTruthy();
  });

  it("formats amounts, percentages and dates, and validates numbers", async () => {
    const wb = await open(await build("btp_chantiers"));
    const ws = wb.getWorksheet("Saisie_Chantiers")!;
    expect(ws.getCell("C2").numFmt).toBe('#,##0 "FCFA"');
    expect(ws.getCell("E2").numFmt).toBe('0.0" %"');
    expect(ws.getCell("E2").dataValidation).toMatchObject({ type: "decimal", operator: "between", formulae: [0, 100] });
    expect(ws.getCell("C2").dataValidation).toMatchObject({ type: "whole", operator: "greaterThanOrEqual", formulae: [0] });
    expect(ws.getCell(`A${MAX_ENTRY_ROWS + 1}`).dataValidation).toBeUndefined();
    expect(ws.getCell(`C${MAX_ENTRY_ROWS + 1}`).dataValidation).toBeTruthy();
  });

  it("limits date columns to the period of the deposit", async () => {
    const ctx = { options: { produits: ["Gel douche"], unites: { "Gel douche": ["litre"] } } };
    const wb = await open(await build("hotel_consommables_cpro", { options: ctx.options }));
    const date = wb.getWorksheet("Saisie_CPRO")!.getCell("D2");
    expect(date.numFmt).toBe("dd/mm/yyyy");
    const formulae = date.dataValidation!.formulae as Date[];
    expect(date.dataValidation).toMatchObject({ type: "date", operator: "between" });
    expect(formulae.map((d) => new Date(d).getUTCFullYear())).toEqual([2026, 2026]);
  });

  it("offers drop-down lists from the client's configuration, in a hidden sheet when too long", async () => {
    const produits = Array.from({ length: 40 }, (_, i) => `Produit numéro ${i}`);
    const wb = await open(await build("hotel_consommables_cpro", { options: { produits, unites: { "Produit numéro 0": ["litre", "bidon 4 L"] } } }));
    const ws = wb.getWorksheet("Saisie_CPRO")!;
    expect(ws.getCell("A2").dataValidation).toMatchObject({ type: "list", formulae: ["_lists!$A$1:$A$40"] });
    expect(ws.getCell("B2").dataValidation).toMatchObject({ type: "list", formulae: ['"litre,bidon 4 L"'] });
    expect(wb.getWorksheet("_lists")!.getCell("A40").value).toBe("Produit numéro 39");
  });

  it("has no drop-down when the client's list is not configured, and keeps fixed options inline", async () => {
    const wb = await open(await build("hotel_consommables_cpro"));
    expect(wb.getWorksheet("Saisie_CPRO")!.getCell("A2").dataValidation).toBeUndefined();
  });

  it("writes the instructions: entity, period, due date and the rules of each sheet", async () => {
    const wb = await open(await build("tech_mensuel"));
    const text: string[] = [];
    wb.getWorksheet("Instructions")!.eachRow((row) => row.eachCell((c) => text.push(String(c.value))));
    const all = text.join("\n");
    expect(all).toContain("Hôtel Lagune");
    expect(all).toContain("01/10/2026 au 31/10/2026 (31 jours)");
    expect(all).toContain("03/11/2026");
    expect(all).toContain("Feuille « Saisie_Tech »");
    expect(all).toContain("Feuille « Tresorerie » — Trésorerie de la société (une seule ligne)");
    expect(all).toContain("MRR perdu");
  });

  it("pre-fills the first row", async () => {
    const wb = await open(await build("hotel_mensuel", { prefill: { Saisie_Mensuelle: { nombreChambres: 40 } } }));
    expect(wb.getWorksheet("Saisie_Mensuelle")!.getCell("A2").value).toBe(40);
  });

  it("never carries the period as a column", async () => {
    for (const t of ["hotel_mensuel", "resto_mensuel", "commerce_mensuel", "btp_chantiers", "tech_mensuel", "hotel_consommables_cpro"]) {
      const wb = await open(await build(t));
      for (const ws of wb.worksheets.filter((w) => w.state === "visible" && w.name !== "Instructions")) {
        expect((ws.getRow(1).values as string[]).filter(Boolean).some((h) => /^(période|periode|mois)$/i.test(h))).toBe(false);
      }
    }
  });
});

describe("a generated file, filled in, goes through the check", () => {
  it("accepts a correctly filled hotel file", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => fillHotel(wb));
    const r = await check(filled, "hotel_mensuel");
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rows.Saisie_Mensuelle![0]).toMatchObject({ nombreChambres: 40, chambresVendues: 900, caChambres: 45_000_000, commissionsOta: null });
  });

  it("rejects too many rooms sold with the line, the column and the figures", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => fillHotel(wb, { A: 4, B: 125 }));
    const r = await check(filled, "hotel_mensuel");
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 2, columnLabel: "Chambres vendues (nuitées)", message: "Ligne 2, Chambres vendues (nuitées) : 125 est supérieur aux chambres disponibles (124)." });
  });

  it("rejects text typed in a number column, empty required cells and a decimal amount", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => fillHotel(wb, { A: "beaucoup" as never, D: undefined, C: 10.5 }));
    const r = await check(filled, "hotel_mensuel");
    expect(r.errors.map((e) => e.code).sort()).toEqual(["NOT_AN_INTEGER", "NOT_A_NUMBER", "REQUIRED"]);
  });

  it("validates the two sheets of a tech file together, and several lines on the first", async () => {
    const filled = await fill(await build("tech_mensuel"), (wb) => {
      const seg = wb.getWorksheet("Saisie_Tech")!;
      [["App", 10e6], ["API", 4e6]].forEach(([name, mrr], i) => {
        const r = i + 2;
        [name, mrr, (mrr as number) * 1.1, 1e5, 200, 5, 20, 2e6].forEach((v, c) => (seg.getCell(r, c + 1).value = v as string | number));
      });
      const tr = wb.getWorksheet("Tresorerie")!;
      [12e6, 15e6, -3e6].forEach((v, c) => (tr.getCell(2, c + 1).value = v));
    });
    const r = await check(filled, "tech_mensuel");
    expect(r.errors).toEqual([]);
    expect(r.rows.Saisie_Tech).toHaveLength(2);
    expect(r.rows.Tresorerie![0]).toMatchObject({ tresorerieFin: -3_000_000 });
  });

  it("reads the calculated value of a formula, and warns when there is none", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => {
      fillHotel(wb);
      const ws = wb.getWorksheet("Saisie_Mensuelle")!;
      ws.getCell("A2").value = { formula: "20*2", result: 40 };
      ws.getCell("G2").value = { formula: "1+1" } as ExcelJS.CellFormulaValue;
    });
    const r = await check(filled, "hotel_mensuel");
    expect(r.ok).toBe(true);
    expect(r.rows.Saisie_Mensuelle![0]!.nombreChambres).toBe(40);
    expect(r.warnings.map((w) => w.code)).toContain("FORMULA_NO_VALUE");
  });

  it("reads rich text and ignores completely empty rows", async () => {
    const filled = await fill(await build("btp_chantiers"), (wb) => {
      const ws = wb.getWorksheet("Saisie_Chantiers")!;
      [{ richText: [{ text: "C-" }, { text: "01" }] }, "Pont", 1e8, 4e7, 40, 35, 4.5e7, 1.2e8].forEach((v, c) => (ws.getCell(2, c + 1).value = v as ExcelJS.CellValue));
      ws.getCell("A5").value = " ";
    });
    const r = await check(filled, "btp_chantiers");
    expect(r.errors).toEqual([]);
    expect(r.rows.Saisie_Chantiers).toHaveLength(1);
    expect(r.rows.Saisie_Chantiers![0]!.codeChantier).toBe("C-01");
  });

  it("reports a formula error found in the file", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => {
      fillHotel(wb);
      wb.getWorksheet("Saisie_Mensuelle")!.getCell("C2").value = { error: "#DIV/0!" } as ExcelJS.CellErrorValue;
    });
    expect((await check(filled, "hotel_mensuel")).errors[0]).toMatchObject({ code: "EXCEL_ERROR", row: 2 });
  });
});

describe("file identity (_meta)", () => {
  it("blocks a file generated for another period, with a single clear message", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => fillHotel(wb));
    const r = await check(filled, "hotel_mensuel", { periodId: "period-nov" });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toEqual(["META_WRONG_PERIOD"]);
    expect(r.errors[0]!.message).toContain("autre période");
  });

  it("blocks a file generated for another entity, or for another template", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => fillHotel(wb));
    expect((await check(filled, "hotel_mensuel", { entityId: "entity-2" })).errors.map((e) => e.code)).toEqual(["META_WRONG_ENTITY"]);
    const resto = await fill(await build("resto_mensuel"), () => undefined);
    const asHotel = await checkWorkbook({ buffer: resto, template: getTemplate("hotel_mensuel")!, expected: { entityId: ENTITY.id, periodId: PERIOD.id }, ctx: CTX, secret: SECRET });
    expect(asHotel.errors.map((e) => e.code)).toContain("META_WRONG_TEMPLATE");
  });

  it("reports every mismatch at once", async () => {
    const filled = await fill(await build("hotel_mensuel"), () => undefined);
    const r = await check(filled, "hotel_mensuel", { entityId: "x", periodId: "y" });
    expect(r.errors.map((e) => e.code)).toEqual(["META_WRONG_ENTITY", "META_WRONG_PERIOD"]);
  });

  it("checks a hand-made file anyway, with a warning, when _meta is missing", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => {
      fillHotel(wb);
      wb.removeWorksheet("_meta");
    });
    const r = await check(filled, "hotel_mensuel");
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["META_ABSENT"]);
  });

  it("treats a signature made with another secret, or a damaged one, as untrusted but still checks the content", async () => {
    const filled = await fill(await build("hotel_mensuel", { secret: "another-secret-another-secret-another-1" }), (wb) => fillHotel(wb, { A: 4, B: 125 }));
    const forged = await check(filled, "hotel_mensuel");
    expect(forged.warnings.map((w) => w.code)).toEqual(["META_INVALID"]);
    expect(forged.errors.map((e) => e.code)).toEqual(["CROSS_RULE"]);

    const damaged = await fill(await build("hotel_mensuel"), (wb) => (wb.getWorksheet("_meta")!.getCell("B5").value = "not-a-token"));
    expect((await check(damaged, "hotel_mensuel")).warnings.map((w) => w.code)).toEqual(["META_INVALID"]);
  });

  it("does not let a forged _meta redirect a file to another period", async () => {
    // The attacker rewrites the visible ids but cannot sign: the file is untrusted, not trusted for the wrong period.
    const filled = await fill(await build("hotel_mensuel", { period: { ...PERIOD, id: "period-nov" } }), (wb) => {
      fillHotel(wb);
      wb.getWorksheet("_meta")!.getCell("B4").value = PERIOD.id;
    });
    const r = await check(filled, "hotel_mensuel");
    expect(r.errors.map((e) => e.code)).toEqual(["META_WRONG_PERIOD"]);
  });

  it("rejects missing headers, and says to use the platform's template", async () => {
    const filled = await fill(await build("hotel_mensuel"), (wb) => {
      fillHotel(wb);
      wb.getWorksheet("Saisie_Mensuelle")!.getCell("B1").value = "Nuitées";
    });
    const r = await check(filled, "hotel_mensuel");
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toEqual(["HEADER_MISSING"]);
    expect(r.errors[0]!.message).toContain("Chambres vendues (nuitées)");
    expect(r.warnings.map((w) => w.code)).toContain("UNKNOWN_COLUMN");
  });

  it("reports a missing entry sheet through the engine", async () => {
    const filled = await fill(await build("tech_mensuel"), (wb) => wb.removeWorksheet("Tresorerie"));
    expect((await check(filled, "tech_mensuel")).errors.map((e) => e.code)).toContain("SHEET_MISSING");
  });
});

describe("template route service", () => {
  beforeEach(resetDatabase);
  afterAll(shutdown);

  async function seed() {
    const clientA = await createClientCompany("Groupe A");
    const clientB = await createClientCompany("Groupe B");
    const a1 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A1", sector: "HOTELLERIE" } });
    const a2 = await db().entity.create({ data: { clientId: clientA.id, name: "Hôtel A2", sector: "HOTELLERIE" } });
    const b1 = await db().entity.create({ data: { clientId: clientB.id, name: "Hôtel B1", sector: "HOTELLERIE" } });
    const period = async (entityId: string, templateId = "hotel_mensuel") => {
      const plan = await db().collectionPlan.create({ data: { entityId, templateId, startsOn: day(2026, 1, 1) } });
      return db().collectionPeriod.create({ data: { planId: plan.id, periodStart: PERIOD.start, periodEnd: PERIOD.end, dueAt: PERIOD.dueAt } });
    };
    return {
      p1: await period(a1.id),
      p2: await period(a2.id),
      pb: await period(b1.id),
      pUnknownTemplate: await period(a1.id, "inconnu"),
      admin: await createUser({ role: "ADMIN" }),
      direction: await createUser({ role: "CLIENT_DIRECTION", clientId: clientA.id }),
      analyst: await createUser({ role: "CLIENT_ANALYSTE", clientId: clientA.id }),
      contributor: await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: clientA.id }),
      a1,
    };
  }
  const service = () => createTemplateService({ prisma: db(), secret: SECRET });
  const actor = (u: { id: string; role: "ADMIN" | "CLIENT_DIRECTION" | "CLIENT_CONTRIBUTEUR" | "CLIENT_ANALYSTE"; clientId: string | null }) => ({ userId: u.id, role: u.role, clientId: u.clientId });

  it("builds a signed file bound to the entity and the period, named after both", async () => {
    const s = await seed();
    const { buffer, filename } = await service().buildForPeriod(actor(s.direction), s.p1.id);
    expect(filename).toBe("hotel_mensuel_Hotel-A1_2026-10.xlsx");
    const filled = await fill(buffer, (wb) => fillHotel(wb));
    const ok = await checkWorkbook({ buffer: filled, template: getTemplate("hotel_mensuel")!, expected: { entityId: s.a1.id, periodId: s.p1.id }, ctx: CTX, secret: SECRET });
    expect(ok.errors).toEqual([]);
    const wrong = await checkWorkbook({ buffer: filled, template: getTemplate("hotel_mensuel")!, expected: { entityId: s.a1.id, periodId: s.p2.id }, ctx: CTX, secret: SECRET });
    expect(wrong.errors.map((e) => e.code)).toEqual(["META_WRONG_PERIOD"]);
  });

  it("lets an assigned contributor download theirs and answers 404 for another entity of the same client", async () => {
    const s = await seed();
    await db().entityAssignment.create({ data: { userId: s.contributor.id, entityId: s.a1.id } });
    await expect(service().buildForPeriod(actor(s.contributor), s.p1.id)).resolves.toBeTruthy();
    await expect(service().buildForPeriod(actor(s.contributor), s.p2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers the same for another client's period and for one that does not exist", async () => {
    const s = await seed();
    for (const id of [s.pb.id, "does-not-exist"]) {
      await expect(service().buildForPeriod(actor(s.direction), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("refuses the read-only analyst, and lets the admin build any file", async () => {
    const s = await seed();
    await expect(service().buildForPeriod(actor(s.analyst), s.p1.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service().buildForPeriod(actor(s.admin), s.pb.id)).resolves.toBeTruthy();
  });

  it("refuses a period whose template is unknown", async () => {
    const s = await seed();
    await expect(service().buildForPeriod(actor(s.admin), s.pUnknownTemplate.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
