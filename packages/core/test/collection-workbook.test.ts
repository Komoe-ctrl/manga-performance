import { crc32, deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  MAX_ARCHIVE_ENTRIES,
  checkWorkbook,
  getTemplate,
  inspectXlsxArchive,
  readWorkbookCells,
  signMeta,
  WorkbookGuardError,
  type PeriodContext,
} from "../src/collection";

const SECRET = "test-secret-test-secret-test-secret-1234";
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const CTX: PeriodContext = { periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31) };
const EXPECTED = { entityId: "entity-1", periodId: "period-oct" };

/** A small, valid resto file (one sheet), with or without the signed `_meta` sheet. */
async function restoFile(options: { meta?: boolean; values?: (number | string | undefined)[]; headers?: string[] } = {}): Promise<Buffer> {
  const template = getTemplate("resto_mensuel")!;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Saisie_Restaurant");
  (options.headers ?? template.sheets[0]!.columns.map((c) => c.label)).forEach((h, i) => (ws.getCell(1, i + 1).value = h));
  (options.values ?? [10_000_000, 3_000_000, 2_500_000, 2_000_000, 1_000]).forEach((v, i) => (ws.getCell(2, i + 1).value = v));
  if (options.meta !== false) {
    const meta = wb.addWorksheet("_meta");
    meta.getCell("A5").value = "signature";
    meta.getCell("B5").value = signMeta({ templateId: template.id, version: template.version, ...EXPECTED }, SECRET);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const check = (buffer: Uint8Array, over: Partial<Parameters<typeof checkWorkbook>[0]> = {}) =>
  checkWorkbook({ buffer, template: getTemplate("resto_mensuel")!, expected: EXPECTED, ctx: CTX, secret: SECRET, ...over });

/** Minimal ZIP writer, to build the trap files the avenant lists (macro, zip bomb…). */
interface ZipEntry {
  name: string;
  data: Buffer;
  /** Size written in the headers, to lie about it. */
  declaredSize?: number;
  stored?: boolean;
}
function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const body = entry.stored ? entry.data : deflateRawSync(entry.data);
    const name = Buffer.from(entry.name);
    const size = entry.declaredSize ?? entry.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.stored ? 0 : 8, 10);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe("a valid file", () => {
  it("is read, identified and checked", async () => {
    const r = await check(await restoFile());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rows.Saisie_Restaurant![0]).toMatchObject({ caHt: 10_000_000, nombreCouverts: 1000 });
  });
  it("reports an empty cell and keeps what could be read", async () => {
    const r = await check(await restoFile({ values: [undefined, 3_000_000, 2_500_000, 2_000_000] }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: "REQUIRED", row: 2, columnLabel: "CA HT (FCFA)" });
    expect(r.rows.Saisie_Restaurant![0]).toMatchObject({ caHt: null, coutMatieres: 3_000_000 });
  });
});

describe("trap files", () => {
  it("refuses a macro-enabled workbook (.xlsm renamed .xlsx)", async () => {
    const base = await restoFile();
    const zip = makeZip([{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") }, { name: "xl/workbook.xml", data: Buffer.from("<workbook/>") }, { name: "xl/vbaProject.bin", data: Buffer.from("MZ macro") }]);
    expect(base.length).toBeGreaterThan(0);
    const r = await check(zip);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "MACRO", sheet: "Fichier" });
    expect(r.errors[0]!.message).toContain("macros");
  });

  it("refuses an old .xls file", async () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    expect((await check(ole)).errors[0]).toMatchObject({ code: "OLD_FORMAT" });
  });

  it("refuses something that is not a zip, a truncated zip and an empty buffer", async () => {
    expect((await check(Buffer.from("just some text, nothing else here at all!"))).errors[0]).toMatchObject({ code: "NOT_A_ZIP" });
    const file = await restoFile();
    expect((await check(file.subarray(0, file.length - 40))).errors[0]).toMatchObject({ code: "NOT_A_ZIP" });
    expect((await check(Buffer.alloc(0))).errors[0]).toMatchObject({ code: "NOT_A_ZIP" });
  });

  it("refuses a zip bomb that announces its size (60 MB of zeros)", async () => {
    const bomb = makeZip([{ name: "xl/sheet.xml", data: Buffer.alloc(60 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(200_000);
    const r = await check(bomb);
    expect(r.errors[0]).toMatchObject({ code: expect.stringMatching(/TOO_LARGE|SUSPICIOUS/) });
  });

  it("refuses a zip bomb that LIES about its size: the content is really inflated under a budget", async () => {
    const bomb = makeZip([{ name: "xl/sheet.xml", data: Buffer.alloc(60 * 1024 * 1024), declaredSize: 1000 }]);
    const verdict = inspectXlsxArchive(bomb);
    expect(verdict).toMatchObject({ ok: false, code: "TOO_LARGE" });
  });

  it("refuses a very high compression ratio even below the limit", () => {
    const squeezed = makeZip([{ name: "xl/sheet.xml", data: Buffer.alloc(20 * 1024 * 1024) }]);
    expect(inspectXlsxArchive(squeezed)).toMatchObject({ ok: false, code: "SUSPICIOUS" });
  });

  it("refuses too many internal files and paths that try to escape", () => {
    const many = makeZip(Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, i) => ({ name: `f${i}.xml`, data: Buffer.from("x") })));
    expect(inspectXlsxArchive(many)).toMatchObject({ ok: false, code: "SUSPICIOUS" });
    expect(inspectXlsxArchive(makeZip([{ name: "../evil.xml", data: Buffer.from("x") }]))).toMatchObject({ ok: false, code: "SUSPICIOUS" });
    expect(inspectXlsxArchive(makeZip([{ name: "/abs.xml", data: Buffer.from("x") }]))).toMatchObject({ ok: false, code: "SUSPICIOUS" });
    expect(inspectXlsxArchive(makeZip([{ name: "a\\b.xml", data: Buffer.from("x") }]))).toMatchObject({ ok: false, code: "SUSPICIOUS" });
  });

  it("accepts stored (uncompressed) entries and macro sheets are refused too", () => {
    expect(inspectXlsxArchive(makeZip([{ name: "[Content_Types].xml", data: Buffer.from("<Types/>"), stored: true }]))).toMatchObject({ ok: true, entries: 1 });
    expect(inspectXlsxArchive(makeZip([{ name: "xl/macrosheets/sheet1.xml", data: Buffer.from("<x/>") }]))).toMatchObject({ ok: false, code: "MACRO" });
  });

  it("refuses an archive whose entries cannot be inflated", () => {
    const zip = makeZip([{ name: "a.xml", data: Buffer.from("hello hello hello hello") }]);
    // Corrupt the deflate stream.
    zip[30 + "a.xml".length] = 0xff;
    zip[31 + "a.xml".length] = 0xff;
    expect(inspectXlsxArchive(zip)).toMatchObject({ ok: false, code: "NOT_A_ZIP" });
  });

  it("refuses a compression method it does not know, and a broken directory", () => {
    const odd = makeZip([{ name: "a.xml", data: Buffer.from("x") }]);
    // Central directory starts after local header (30) + name (5) + data; patch the method field of the central entry.
    const centralAt = odd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    odd.writeUInt16LE(99, centralAt + 10);
    expect(inspectXlsxArchive(odd)).toMatchObject({ ok: false, code: "SUSPICIOUS" });

    const broken = makeZip([{ name: "a.xml", data: Buffer.from("x") }]);
    broken.writeUInt32LE(0xdeadbeef, broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    expect(inspectXlsxArchive(broken)).toMatchObject({ ok: false, code: "NOT_A_ZIP" });

    const badLocal = makeZip([{ name: "a.xml", data: Buffer.from("x") }]);
    badLocal.writeUInt32LE(0, 0);
    expect(inspectXlsxArchive(badLocal)).toMatchObject({ ok: false, code: "NOT_A_ZIP" });
  });

  it("refuses a valid archive that is not a workbook, and one whose workbook cannot be parsed", async () => {
    const notAWorkbook = await check(makeZip([{ name: "hello.txt", data: Buffer.from("hello") }]));
    expect(notAWorkbook.ok).toBe(false);
    expect(notAWorkbook.errors.map((e) => e.code)).toContain("SHEET_MISSING");
    const garbage = makeZip([
      { name: "[Content_Types].xml", data: Buffer.from("<<<not xml") },
      { name: "xl/workbook.xml", data: Buffer.from("<<<not xml") },
    ]);
    expect((await check(garbage)).errors[0]).toMatchObject({ code: "UNREADABLE" });
  });

  it("refuses a sheet with too many rows or columns, and a read that takes too long", async () => {
    const file = await restoFile();
    expect((await check(file, { limits: { maxRows: 1, maxColumns: 100, timeoutMs: 30_000 } })).errors[0]).toMatchObject({ code: "TOO_MANY_ROWS" });
    expect((await check(file, { limits: { maxRows: 100, maxColumns: 2, timeoutMs: 30_000 } })).errors[0]).toMatchObject({ code: "TOO_MANY_COLUMNS" });
    expect((await check(file, { limits: { maxRows: 100, maxColumns: 100, timeoutMs: 0 } })).errors[0]).toMatchObject({ code: "TIMEOUT" });
    await expect(readWorkbookCells(file, getTemplate("resto_mensuel")!, SECRET, { maxRows: 1, maxColumns: 100, timeoutMs: 1000 })).rejects.toBeInstanceOf(WorkbookGuardError);
  });

  it("does not hide an unexpected internal error", async () => {
    await expect(checkWorkbook({ buffer: null as unknown as Uint8Array, template: getTemplate("resto_mensuel")!, expected: EXPECTED, ctx: CTX, secret: SECRET })).rejects.toThrow();
  });
});

describe("wrong sheet, wrong period, wrong headers", () => {
  it("rejects a file without the expected sheet", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Autre").getCell("A1").value = "x";
    const r = await check(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("SHEET_MISSING");
  });

  it("rejects a file made for another period, with one message", async () => {
    const r = await check(await restoFile(), { expected: { entityId: "entity-1", periodId: "period-nov" } });
    expect(r.errors.map((e) => e.code)).toEqual(["META_WRONG_PERIOD"]);
  });

  it("checks a hand-made file without _meta, with a warning", async () => {
    const r = await check(await restoFile({ meta: false }));
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["META_ABSENT"]);
  });

  it("rejects wrong headers, and ignores an extra column with a warning", async () => {
    const template = getTemplate("resto_mensuel")!;
    const labels = template.sheets[0]!.columns.map((c) => c.label);
    const r = await check(await restoFile({ headers: ["Chiffre d'affaires", ...labels.slice(1)] }));
    expect(r.errors.map((e) => e.code)).toEqual(["HEADER_MISSING"]);
    expect(r.warnings.map((w) => w.code)).toContain("UNKNOWN_COLUMN");
  });
});

describe("signatures (_meta helpers)", () => {
  it("round-trips a signed identity and refuses another secret or a malformed payload", async () => {
    const file = await restoFile();
    const ok = await readWorkbookCells(file, getTemplate("resto_mensuel")!, SECRET);
    expect(ok.meta).toMatchObject({ status: "valid", entityId: "entity-1", periodId: "period-oct", templateId: "resto_mensuel" });
    const other = await readWorkbookCells(file, getTemplate("resto_mensuel")!, "another-secret-another-secret-another-1");
    expect(other.meta.status).toBe("invalid");
  });
  it("treats a validly signed token with a wrong shape as invalid", async () => {
    const { signToken } = await import("../src/signed-tokens");
    const { readMeta } = await import("../src/collection");
    expect(readMeta(signToken("collection-template", { templateId: 1 }, SECRET), SECRET).status).toBe("invalid");
    expect(readMeta(null, SECRET).status).toBe("absent");
  });
  it("wording of the warnings and errors", async () => {
    const { checkMeta } = await import("../src/collection");
    const bad = checkMeta({ status: "valid", templateId: "x", version: 1, entityId: "a", periodId: "b" }, { templateId: "y", entityId: "c", periodId: "d" });
    expect(bad.map((i) => i.code)).toEqual(["META_WRONG_TEMPLATE", "META_WRONG_ENTITY", "META_WRONG_PERIOD"]);
    expect(checkMeta({ status: "invalid" }, { templateId: "y", entityId: "c", periodId: "d" })[0]!.severity).toBe("warning");
  });
});
