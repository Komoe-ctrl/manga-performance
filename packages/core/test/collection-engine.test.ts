import { describe, expect, it } from "vitest";
import { daysInPeriod, formatDateFr, formatNumberFr, isBlank, isExcelError, parseDate, parseNumber } from "../src/collection/cells";
import { MAX_ISSUES, expectedHeaders, matchHeaders, validateSubmission } from "../src/collection/engine";
import type { InputRow, PeriodContext, SheetDef, TemplateDef } from "../src/collection/types";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const OCTOBER: PeriodContext = { periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31) };

const row = (rowNumber: number, cells: InputRow["cells"]): InputRow => ({ rowNumber, cells });

function template(columns: SheetDef["columns"], rows: SheetDef["rows"] = "multiple"): TemplateDef {
  return { id: "t", version: 1, sector: "COMMERCE", label: "T", sheets: [{ name: "S", label: "S", rows, columns }] };
}
const run = (t: TemplateDef, rows: InputRow[], ctx: PeriodContext = OCTOBER) => validateSubmission(t, { S: rows }, ctx);

describe("cell parsing", () => {
  it("reads numbers written in French or as plain numbers", () => {
    expect(parseNumber(42)).toEqual({ ok: true, value: 42 });
    expect(parseNumber("1 250,75")).toEqual({ ok: true, value: 1250.75 });
    expect(parseNumber("1 250 000 FCFA")).toEqual({ ok: true, value: 1_250_000 });
    expect(parseNumber("12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parseNumber("55 %")).toEqual({ ok: true, value: 55 });
  });
  it("refuses anything that is not unambiguously a number", () => {
    expect(parseNumber("12abc").ok).toBe(false);
    expect(parseNumber("1,2,3").ok).toBe(false);
    expect(parseNumber(Number.NaN).ok).toBe(false);
    expect(parseNumber(true).ok).toBe(false);
    expect(parseNumber(new Date()).ok).toBe(false);
  });
  it("reads dates as calendar days and refuses impossible ones", () => {
    expect(parseDate("03/10/2026")).toEqual({ ok: true, value: day(2026, 10, 3) });
    expect(parseDate("2026-10-03")).toEqual({ ok: true, value: day(2026, 10, 3) });
    expect(parseDate(day(2026, 10, 3))).toEqual({ ok: true, value: day(2026, 10, 3) });
    expect(parseDate(new Date(Date.UTC(2026, 9, 3, 23, 59))).ok).toBe(true);
    expect(parseDate("31/02/2026").ok).toBe(false);
    expect(parseDate("hier").ok).toBe(false);
    expect(parseDate(new Date("nope")).ok).toBe(false);
    expect(parseDate(12).ok).toBe(false);
  });
  it("formats for messages and counts the days of a period", () => {
    expect(formatNumberFr(1250.75)).toBe("1 250,75");
    expect(formatNumberFr(120)).toBe("120");
    expect(formatDateFr(day(2026, 10, 3))).toBe("03/10/2026");
    expect(daysInPeriod(day(2026, 10, 1), day(2026, 10, 31))).toBe(31);
    expect(daysInPeriod(day(2026, 2, 1), day(2026, 2, 28))).toBe(28);
    expect(isBlank("  ")).toBe(true);
    expect(isBlank(0)).toBe(false);
    expect(isExcelError("#DIV/0!")).toBe(true);
    expect(isExcelError("#hello")).toBe(false);
  });
});

describe("column rules", () => {
  const t = template([{ key: "n", label: "Nombre", kind: "integer", required: true }]);

  it("accepts a valid row and normalises its values", () => {
    const r = run(t, [row(2, { n: "12" })]);
    expect(r.ok).toBe(true);
    expect(r.rows.S).toEqual([{ n: 12 }]);
  });

  it("rejects a required value left empty, with the row and the column in the message", () => {
    const two = template([{ key: "n", label: "Nombre", kind: "integer", required: true }, { key: "t", label: "Texte", kind: "text" }]);
    const r = run(two, [row(7, { n: "  ", t: "x" }), row(8, { n: 3 })]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ severity: "error", row: 7, column: "n", columnLabel: "Nombre", code: "REQUIRED", message: "Ligne 7, Nombre : valeur requise, la cellule est vide." });
    expect(r.rows.S).toEqual([]);
  });

  it("lets an optional value stay empty", () => {
    const opt = template([{ key: "n", label: "Nombre", kind: "integer" }, { key: "t", label: "T", kind: "text", required: true }]);
    const r = run(opt, [row(2, { t: "a" })]);
    expect(r.ok).toBe(true);
    expect(r.rows.S).toEqual([{ n: null, t: "a" }]);
  });

  it("rejects text, decimals and negatives in an integer column", () => {
    expect(run(t, [row(2, { n: "abc" })]).errors[0]).toMatchObject({ code: "NOT_A_NUMBER", value: "abc" });
    expect(run(t, [row(2, { n: 2.5 })]).errors[0]).toMatchObject({ code: "NOT_AN_INTEGER" });
    expect(run(t, [row(2, { n: -1 })]).errors[0]).toMatchObject({ code: "BELOW_MIN", message: "Ligne 2, Nombre : -1 est négatif : la valeur doit être positive ou nulle." });
  });

  it("flags a formula that failed in the file", () => {
    expect(run(t, [row(2, { n: "#DIV/0!" })]).errors[0]).toMatchObject({ code: "EXCEL_ERROR" });
  });

  it("enforces min, max and strict lower bounds", () => {
    const b = template([{ key: "n", label: "Valeur", kind: "integer", min: 5, max: 10 }, { key: "g", label: "Gros", kind: "integer", gt: 0 }]);
    expect(run(b, [row(2, { n: 4, g: 1 })]).errors[0]).toMatchObject({ code: "BELOW_MIN" });
    expect(run(b, [row(2, { n: 11, g: 1 })]).errors[0]).toMatchObject({ code: "ABOVE_MAX" });
    expect(run(b, [row(2, { n: 5, g: 0 })]).errors[0]).toMatchObject({ code: "TOO_LOW" });
    expect(run(b, [row(2, { n: 10, g: 1 })]).ok).toBe(true);
  });

  it("requires whole FCFA for amounts, and non-negative unless stated", () => {
    const a = template([{ key: "m", label: "Montant", kind: "amount", required: true }]);
    expect(run(a, [row(2, { m: 1000.5 })]).errors[0]).toMatchObject({ code: "NOT_AN_INTEGER" });
    expect(run(a, [row(2, { m: -5 })]).errors[0]).toMatchObject({ code: "BELOW_MIN" });
    expect(run(a, [row(2, { m: "1 250 000" })]).rows.S).toEqual([{ m: 1_250_000 }]);
    const neg = template([{ key: "m", label: "Trésorerie", kind: "amount", required: true, allowNegative: true }]);
    expect(run(neg, [row(2, { m: -5_000_000 })]).ok).toBe(true);
  });

  it("keeps percentages between 0 and 100 with one decimal, rounding with a warning", () => {
    const p = template([{ key: "p", label: "Avancement %", kind: "percent", required: true }]);
    expect(run(p, [row(2, { p: 100.5 })]).errors[0]).toMatchObject({ code: "ABOVE_MAX" });
    expect(run(p, [row(2, { p: -1 })]).errors[0]).toMatchObject({ code: "BELOW_MIN" });
    const rounded = run(p, [row(2, { p: 55.56 })]);
    expect(rounded.ok).toBe(true);
    expect(rounded.rows.S).toEqual([{ p: 55.6 }]);
    expect(rounded.warnings[0]).toMatchObject({ code: "ROUNDED" });
    expect(run(p, [row(2, { p: 55.5 })]).warnings).toEqual([]);
  });

  it("stores decimals with four digits", () => {
    const d = template([{ key: "q", label: "Quantité", kind: "decimal", required: true, gt: 0 }]);
    expect(run(d, [row(2, { q: "2,5" })]).rows.S).toEqual([{ q: 2.5 }]);
    expect(run(d, [row(2, { q: 1.123456 })]).rows.S).toEqual([{ q: 1.1235 }]);
    expect(run(d, [row(2, { q: 0 })]).errors[0]).toMatchObject({ code: "TOO_LOW" });
  });

  it("limits the length of text and accepts a number or a date typed in a text column", () => {
    const x = template([{ key: "t", label: "Texte", kind: "text", required: true }]);
    expect(run(x, [row(2, { t: "a".repeat(201) })]).errors[0]).toMatchObject({ code: "TOO_LONG" });
    expect(run(x, [row(2, { t: 123 })]).rows.S).toEqual([{ t: "123" }]);
    expect(run(x, [row(2, { t: day(2026, 10, 3) })]).rows.S).toEqual([{ t: "03/10/2026" }]);
  });

  it("checks enums against fixed options, ignoring case, and returns the canonical option", () => {
    const e = template([{ key: "c", label: "Couleur", kind: "enum", required: true, options: ["Rouge", "Vert"] }]);
    expect(run(e, [row(2, { c: " vert " })]).rows.S).toEqual([{ c: "Vert" }]);
    expect(run(e, [row(2, { c: "bleu" })]).errors[0]).toMatchObject({ code: "NOT_IN_LIST", message: "Ligne 2, Couleur : « bleu » n'est pas dans la liste autorisée (Rouge, Vert)." });
  });

  it("shortens a long list of options in the message", () => {
    const many = Array.from({ length: 12 }, (_, i) => `P${i}`);
    const e = template([{ key: "c", label: "Produit", kind: "enum", options: many }]);
    expect(run(e, [row(2, { c: "zz" })]).errors[0]!.message).toContain("P7…");
  });

  it("checks dates against the period of the deposit", () => {
    const d = template([{ key: "d", label: "Date", kind: "date", required: true }]);
    expect(run(d, [row(2, { d: "15/10/2026" })]).rows.S).toEqual([{ d: "2026-10-15" }]);
    expect(run(d, [row(2, { d: "01/10/2026" }), row(3, { d: "31/10/2026" })]).ok).toBe(true);
    expect(run(d, [row(2, { d: "03/11/2026" })]).errors[0]).toMatchObject({ code: "DATE_OUT_OF_PERIOD", message: "Ligne 2, Date : 03/11/2026 est hors de la période (01/10/2026 au 31/10/2026)." });
    expect(run(d, [row(2, { d: "30/09/2026" })]).errors[0]).toMatchObject({ code: "DATE_OUT_OF_PERIOD" });
    expect(run(d, [row(2, { d: "32/10/2026" })]).errors[0]).toMatchObject({ code: "INVALID_DATE" });
    const free = template([{ key: "d", label: "Date", kind: "date", dateInPeriod: false }]);
    expect(run(free, [row(2, { d: "03/11/2026" })]).ok).toBe(true);
  });

  it("makes a column required only when another one is filled", () => {
    const c = template([{ key: "tpv", label: "TPV", kind: "amount" }, { key: "rev", label: "Revenu", kind: "amount", requiredIf: "tpv" }]);
    expect(run(c, [row(2, { tpv: 1000 })]).errors[0]).toMatchObject({ code: "REQUIRED", column: "rev", message: "Ligne 2, Revenu : valeur requise lorsque « TPV » est renseigné." });
    expect(run(c, [row(2, { tpv: 1000, rev: 30 })]).ok).toBe(true);
    expect(run(c, [row(2, { tpv: 1000, rev: 0 })]).ok).toBe(true);
    expect(run(c, [row(2, { rev: 5 })]).ok).toBe(true);
    expect(run(c, [row(2, {})]).errors[0]).toMatchObject({ code: "EMPTY" });
  });
});

describe("uniqueness", () => {
  const t = template([{ key: "code", label: "Code", kind: "text", required: true, uniqueInFile: true }]);
  it("rejects a repeated value and says where the first one is", () => {
    const r = run(t, [row(2, { code: "A" }), row(3, { code: "B" }), row(4, { code: " a " })]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "DUPLICATE", row: 4, message: "Ligne 4, Code : « a » apparaît déjà ligne 2." });
  });
  it("accepts distinct values", () => {
    expect(run(t, [row(2, { code: "A" }), row(3, { code: "B" })]).ok).toBe(true);
  });
  it("only warns when a duplicate is configured as a warning, per group", () => {
    const g = template([
      { key: "p", label: "Produit", kind: "text", required: true },
      { key: "bon", label: "Bon", kind: "text", required: true, uniqueWithin: "p", duplicate: "warning" },
    ]);
    const r = run(g, [row(2, { p: "Gel", bon: "B1" }), row(3, { p: "Savon", bon: "B1" }), row(4, { p: "Gel", bon: "B1" })]);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: "DUPLICATE", row: 4, message: "Ligne 4, Bon : « B1 » apparaît déjà ligne 2 pour ce produit." });
  });
});

describe("cross rules", () => {
  const t = template(
    [
      { key: "dispo", label: "Chambres", kind: "integer", required: true },
      { key: "vendues", label: "Vendues", kind: "integer", required: true, crossRules: [{ op: "lte", other: "dispo", times: "days", against: "aux chambres disponibles" }] },
      { key: "ca", label: "CA", kind: "amount", required: true },
      { key: "total", label: "Total", kind: "amount", required: true, crossRules: [{ op: "gte", other: "ca" }] },
    ],
    "single",
  );
  it("multiplies by the number of days of the period and words the message in French", () => {
    expect(run(t, [row(2, { dispo: 4, vendues: 124, ca: 1, total: 1 })]).ok).toBe(true);
    const r = run(t, [row(7, { dispo: 4, vendues: 125, ca: 1, total: 1 })]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "CROSS_RULE", message: "Ligne 7, Vendues : 125 est supérieur aux chambres disponibles (124)." });
  });
  it("derives the number of days from the period (February)", () => {
    const feb: PeriodContext = { periodStart: day(2026, 2, 1), periodEnd: day(2026, 2, 28) };
    expect(run(t, [row(2, { dispo: 4, vendues: 113, ca: 1, total: 1 })], feb).errors[0]!.message).toContain("(112)");
  });
  it("uses the label of the other column when no wording is given", () => {
    expect(run(t, [row(2, { dispo: 4, vendues: 1, ca: 100, total: 50 })]).errors[0]!.message).toBe("Ligne 2, Total : 50 est inférieur à « CA » (100).");
  });
  it("sums several columns and supports equality, strict comparisons and warnings", () => {
    const s = template(
      [
        { key: "a", label: "A", kind: "integer", required: true },
        { key: "b", label: "B", kind: "integer", required: true },
        { key: "t", label: "T", kind: "integer", required: true, crossRules: [{ op: "eq", other: ["a", "b"], against: "à la somme" }] },
        { key: "lt", label: "Lt", kind: "integer", crossRules: [{ op: "lt", other: "a" }] },
        { key: "gt", label: "Gt", kind: "integer", crossRules: [{ op: "gt", other: "a", severity: "warning" }] },
      ],
      "single",
    );
    expect(run(s, [row(2, { a: 2, b: 3, t: 5 })]).ok).toBe(true);
    expect(run(s, [row(2, { a: 2, b: 3, t: 6 })]).errors[0]!.message).toBe("Ligne 2, T : 6 ne correspond pas à la somme (5).");
    expect(run(s, [row(2, { a: 2, b: 3, t: 5, lt: 2 })]).errors[0]!.message).toBe("Ligne 2, Lt : 2 n'est pas inférieur à « A » (2).");
    const w = run(s, [row(2, { a: 2, b: 3, t: 5, gt: 1 })]);
    expect(w.ok).toBe(true);
    expect(w.warnings[0]!.message).toBe("Ligne 2, Gt : 1 n'est pas supérieur à « A » (2).");
  });
  it("skips a rule when one side is empty or invalid (a single error is enough)", () => {
    const r = run(t, [row(2, { dispo: "x", vendues: 999, ca: 1, total: 1 })]);
    expect(r.errors.map((e) => e.code)).toEqual(["NOT_A_NUMBER"]);
    const missing = run(t, [row(2, { vendues: 999, ca: 1, total: 1 })]);
    expect(missing.errors.map((e) => e.code)).toEqual(["REQUIRED"]);
  });
});

describe("dynamic enums", () => {
  const t = template([
    { key: "produit", label: "Produit", kind: "enum", required: true, optionsFrom: { name: "produits" } },
    { key: "unite", label: "Unité", kind: "enum", required: true, optionsFrom: { name: "unites", by: "produit" } },
  ]);
  const ctx: PeriodContext = { ...OCTOBER, options: { produits: ["Gel douche", "Papier toilette"], unites: { "Gel douche": ["bidon 4 L", "litre"], "Papier toilette": ["paquet"] } } };

  it("reads the list from the client's configuration and the dependent list from the chosen product", () => {
    expect(run(t, [row(2, { produit: "gel douche", unite: "Litre" })], ctx).rows.S).toEqual([{ produit: "Gel douche", unite: "litre" }]);
    expect(run(t, [row(2, { produit: "Gel douche", unite: "paquet" })], ctx).errors[0]).toMatchObject({ code: "NOT_IN_LIST", column: "unite" });
    expect(run(t, [row(2, { produit: "Savon", unite: "litre" })], ctx).errors.map((e) => e.column)).toEqual(["produit"]);
  });
  it("reports a missing configuration instead of accepting anything", () => {
    expect(run(t, [row(2, { produit: "Gel douche", unite: "litre" })]).errors[0]).toMatchObject({ code: "OPTIONS_UNAVAILABLE" });
    const noUnits: PeriodContext = { ...OCTOBER, options: { produits: ["Gel douche"] } };
    expect(run(t, [row(2, { produit: "Gel douche", unite: "litre" })], noUnits).errors[0]).toMatchObject({ code: "OPTIONS_UNAVAILABLE", column: "unite" });
  });
  it("refuses a unit when the product declares none", () => {
    const empty: PeriodContext = { ...OCTOBER, options: { produits: ["Gel douche"], unites: { "Gel douche": [] } } };
    expect(run(t, [row(2, { produit: "Gel douche", unite: "litre" })], empty).errors[0]!.message).toBe("Ligne 2, Unité : « litre » n'est pas autorisé ici.");
  });
  it("needs a `by` column to read a dependent list", () => {
    const broken = template([{ key: "u", label: "Unité", kind: "enum", optionsFrom: { name: "unites" } }]);
    expect(run(broken, [row(2, { u: "x" })], ctx).errors[0]).toMatchObject({ code: "OPTIONS_UNAVAILABLE" });
  });
});

describe("sheets", () => {
  const two: TemplateDef = {
    id: "two",
    version: 1,
    sector: "TECH_FINTECH",
    label: "Deux feuilles",
    sheets: [
      { name: "A", label: "A", rows: "multiple", columns: [{ key: "x", label: "X", kind: "integer", required: true }] },
      { name: "B", label: "B", rows: "single", columns: [{ key: "y", label: "Y", kind: "integer", required: true }] },
    ],
  };
  it("validates only when every sheet is valid", () => {
    expect(validateSubmission(two, { A: [row(2, { x: 1 })], B: [row(2, { y: 2 })] }, OCTOBER).ok).toBe(true);
    const r = validateSubmission(two, { A: [row(2, { x: 1 })], B: [row(2, { y: "z" })] }, OCTOBER);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ sheet: "B", code: "NOT_A_NUMBER" });
    expect(r.rows).toEqual({ A: [], B: [] });
  });
  it("rejects a missing sheet, an empty sheet and a second line on a single-line sheet", () => {
    expect(validateSubmission(two, { A: [row(2, { x: 1 })] }, OCTOBER).errors[0]).toMatchObject({ code: "SHEET_MISSING", sheet: "B", row: null, message: "La feuille « B » est absente du fichier." });
    expect(validateSubmission(two, { A: [], B: [row(2, { y: 1 })] }, OCTOBER).errors[0]).toMatchObject({ code: "EMPTY", sheet: "A" });
    expect(validateSubmission(two, { A: [row(2, { x: 1 })], B: [row(2, { y: 1 }), row(3, { y: 2 })] }, OCTOBER).errors[0]).toMatchObject({ code: "TOO_MANY_ROWS", row: 3 });
  });
  it("ignores completely empty rows", () => {
    const r = validateSubmission(two, { A: [row(2, { x: 1 }), row(3, {}), row(4, { x: " " })], B: [row(2, { y: 1 })] }, OCTOBER);
    expect(r.ok).toBe(true);
    expect(r.rows.A).toEqual([{ x: 1 }]);
  });
});

describe("report", () => {
  const t = template([{ key: "n", label: "N", kind: "integer", required: true }]);
  it("caps the number of issues and says so, but still rejects", () => {
    const many = Array.from({ length: 30 }, (_, i) => row(i + 2, { n: "x" }));
    const r = validateSubmission(t, { S: many }, OCTOBER, { maxIssues: 10 });
    expect(r.errors).toHaveLength(10);
    expect(r.truncated).toBe(true);
    expect(r.ok).toBe(false);
    expect(MAX_ISSUES).toBe(500);
  });
  it("is not truncated when it fits", () => {
    expect(run(t, [row(2, { n: "x" })]).truncated).toBe(false);
  });
  it("still rejects when the cap is reached by warnings only", () => {
    const w = template([
      { key: "p", label: "P", kind: "percent" },
      { key: "n", label: "N", kind: "integer", required: true },
    ]);
    const rows = [row(2, { p: 1.11, n: 1 }), row(3, { p: 1.11, n: 1 }), row(4, { p: 1.11, n: "x" })];
    const r = validateSubmission(w, { S: rows }, OCTOBER, { maxIssues: 2 });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
  });
  it("skips the coherence checks when there are errors, and reports their warnings otherwise", () => {
    const withCheck: TemplateDef = {
      ...t,
      coherence: [
        () => [{ severity: "warning", sheet: "S", row: null, column: null, columnLabel: null, value: null, code: "X", message: "hm" }],
      ],
    };
    expect(validateSubmission(withCheck, { S: [row(2, { n: 1 })] }, OCTOBER).warnings).toHaveLength(1);
    expect(validateSubmission(withCheck, { S: [row(2, { n: "x" })] }, OCTOBER).warnings).toHaveLength(0);
  });
});

describe("headers", () => {
  const sheet: SheetDef = {
    name: "S",
    label: "S",
    rows: "multiple",
    columns: [
      { key: "a", label: "Chambres vendues (nuitées)", kind: "integer" },
      { key: "b", label: "CA Chambres HT", kind: "amount" },
    ],
  };
  it("lists the expected headers in order", () => {
    expect(expectedHeaders(sheet)).toEqual(["Chambres vendues (nuitées)", "CA Chambres HT"]);
  });
  it("matches headers ignoring case, accents and spacing, whatever their order", () => {
    const { map, issues } = matchHeaders(sheet, ["ca  chambres ht", "CHAMBRES VENDUES (NUITEES)"]);
    expect(map).toEqual({ 0: "b", 1: "a" });
    expect(issues).toEqual([]);
  });
  it("rejects a missing header and only warns about an unknown or repeated one", () => {
    const { issues } = matchHeaders(sheet, ["Chambres vendues (nuitées)", "Commentaire", "", "Chambres vendues (nuitées)"]);
    expect(issues.filter((i) => i.severity === "error").map((i) => i.code)).toEqual(["HEADER_MISSING"]);
    expect(issues.filter((i) => i.severity === "warning").map((i) => i.code)).toEqual(["UNKNOWN_COLUMN"]);
    expect(issues.find((i) => i.code === "HEADER_MISSING")!.message).toContain("CA Chambres HT");
  });
});
