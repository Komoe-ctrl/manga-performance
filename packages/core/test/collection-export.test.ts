import { crc32, inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildConsolidatedWorkbook, createZip, getTemplate, inspectXlsxArchive, neutralizeFormula, periodKey, safeZipName, type ExportDeposit } from "../src/collection";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** Reads back a zip written by `createZip`, checking sizes and CRCs on the way. */
function readZip(zip: Buffer): Record<string, Buffer> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(offset + 16);
    const compressed = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extra = zip.readUInt16LE(offset + 30);
    const comment = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressed));
    expect(data.length).toBe(size);
    expect(crc32(data)).toBe(crc);
    out[name] = data;
    offset += 46 + nameLength + extra + comment;
  }
  return out;
}

describe("neutralizeFormula", () => {
  it("prefixes any text that a spreadsheet could read as a formula", () => {
    for (const bad of ["=1+1", "+33 1", "-SUM(A1)", "@SUM(A1)", '=HYPERLINK("http://x","y")', "\t=1", "\r=1"]) {
      expect(neutralizeFormula(bad)).toBe(`'${bad}`);
    }
  });
  it("leaves ordinary text alone", () => {
    for (const ok of ["Hôtel Lagune", "A=B", "1+1", "", " =1", "O'Brien"]) expect(neutralizeFormula(ok)).toBe(ok);
  });
});

describe("periodKey", () => {
  it("is the month for monthly periods and the start date for weekly ones", () => {
    expect(periodKey(day(2026, 10, 1), day(2026, 10, 31))).toBe("2026-10");
    expect(periodKey(day(2026, 11, 16), day(2026, 11, 22))).toBe("2026-11-16");
  });
});

describe("consolidated workbook", () => {
  const template = getTemplate("resto_mensuel")!;
  const deposit = (client: string, entity: string, month: number, caHt: number, over: Partial<ExportDeposit> = {}): ExportDeposit => ({
    client,
    entity,
    periodStart: day(2026, month, 1),
    periodEnd: day(2026, month + 1, 0),
    version: 1,
    status: "VALIDE",
    rows: { Saisie_Restaurant: [{ caHt, coutMatieres: 3_000_000, chargesPersonnel: 2_000_000, autresCharges: 1_000_000, nombreCouverts: null }] },
    ...over,
  });
  const generatedAt = day(2026, 11, 20);

  async function open(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  }

  it("prefixes every line with client, entity, period, deposit version and status, and fills in the template's columns", async () => {
    const wb = await open(
      await buildConsolidatedWorkbook({
        template,
        generatedAt,
        deposits: [deposit("Groupe A", "Resto 1", 10, 10_000_000, { version: 2 }), deposit("Groupe A", "Resto 2", 10, 8_000_000, { status: "ACCEPTE_AVEC_RESERVE" })],
        missing: [],
      }),
    );
    const ws = wb.getWorksheet("Saisie_Restaurant")!;
    expect((ws.getRow(1).values as string[]).slice(1)).toEqual(["Client", "Entité", "Période", "Version du dépôt", "Statut du dépôt", ...template.sheets[0]!.columns.map((c) => c.label)]);
    expect((ws.getRow(2).values as unknown[]).slice(1, 8)).toEqual(["Groupe A", "Resto 1", "2026-10", 2, "Validé", 10_000_000, 3_000_000]);
    expect((ws.getRow(3).values as unknown[]).slice(1, 6)).toEqual(["Groupe A", "Resto 2", "2026-10", 1, "Accepté avec réserve"]);
    expect(ws.rowCount).toBe(3);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it("sorts by period, then client, then entity", async () => {
    const wb = await open(
      await buildConsolidatedWorkbook({
        template,
        generatedAt,
        deposits: [deposit("B", "Z", 11, 1), deposit("A", "Y", 11, 2), deposit("A", "X", 11, 3), deposit("C", "W", 10, 4)],
        missing: [],
      }),
    );
    const ws = wb.getWorksheet("Saisie_Restaurant")!;
    const order = [2, 3, 4, 5].map((r) => `${ws.getCell(r, 3).value}/${ws.getCell(r, 1).value}/${ws.getCell(r, 2).value}`);
    expect(order).toEqual(["2026-10/C/W", "2026-11/A/X", "2026-11/A/Y", "2026-11/B/Z"]);
  });

  it("neutralises injected formulas in every text cell, and keeps numbers as numbers", async () => {
    const wb = await open(
      await buildConsolidatedWorkbook({
        template: getTemplate("btp_chantiers")!,
        generatedAt,
        deposits: [
          {
            client: "=cmd|' /C calc'!A0",
            entity: "@SUM(1+1)",
            periodStart: day(2026, 10, 1),
            periodEnd: day(2026, 10, 31),
            version: 1,
            status: "VALIDE",
            rows: { Saisie_Chantiers: [{ codeChantier: "=1+1", nomChantier: "-2+3", budgetInitial: -5, coutsReelsCumules: 1, avancementPhysique: 40, avancementFinancier: 35, caFacture: 1, prixMarche: 1 }] },
          },
        ],
        missing: [{ client: "+evil", entity: "-evil", periodStart: day(2026, 9, 1), periodEnd: day(2026, 9, 30), status: "EN_RETARD", dueAt: day(2026, 10, 3) }],
      }),
    );
    const ws = wb.getWorksheet("Saisie_Chantiers")!;
    expect(ws.getCell("A2").value).toBe("'=cmd|' /C calc'!A0");
    expect(ws.getCell("B2").value).toBe("'@SUM(1+1)");
    expect(ws.getCell("F2").value).toBe("'=1+1");
    expect(ws.getCell("G2").value).toBe("'-2+3");
    expect(ws.getCell("H2").value).toBe(-5); // a number, not text: no apostrophe
    // No cell is a formula.
    wb.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => expect(cell.type).not.toBe(ExcelJS.ValueType.Formula))));
    const follow = wb.getWorksheet("Suivi")!;
    expect(follow.getCell("A2").value).toBe("'+evil");
    expect(follow.getCell("B2").value).toBe("'-evil");
  });

  it("writes dates as real dates and keeps missing values empty", async () => {
    const wb = await open(
      await buildConsolidatedWorkbook({
        template: getTemplate("hotel_consommables_cpro")!,
        generatedAt,
        deposits: [
          {
            client: "A",
            entity: "H",
            periodStart: day(2026, 10, 1),
            periodEnd: day(2026, 10, 31),
            version: 1,
            status: "VALIDE",
            rows: {
              Saisie_CPRO: [
                { produit: "Gel", uniteLivraison: "litre", quantite: 12.5, dateLivraison: "2026-10-05", numeroBon: "BL-1", observations: null },
                { produit: "Gel", uniteLivraison: "litre", quantite: 1, dateLivraison: "pas une date", numeroBon: "BL-2" },
              ],
              Population: [{ clientsTotal: 100, clientsPass: 80, clientsLongSejour: 20 }],
            },
          },
        ],
        missing: [],
      }),
    );
    const ws = wb.getWorksheet("Saisie_CPRO")!;
    expect(ws.getCell("I2").value).toEqual(day(2026, 10, 5));
    expect(ws.getCell("I2").numFmt).toBe("dd/mm/yyyy");
    expect(ws.getCell("K2").value).toBeNull();
    expect(ws.getCell("I3").value).toBe("pas une date");
    expect(wb.getWorksheet("Population")!.getCell("F2").value).toBe(100);
  });

  it("has a Suivi sheet listing who is missing, in French, sorted", async () => {
    const wb = await open(
      await buildConsolidatedWorkbook({
        template,
        generatedAt,
        deposits: [],
        missing: [
          { client: "B", entity: "Resto 2", periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31), status: "REJETE", dueAt: day(2026, 11, 3) },
          { client: "A", entity: "Resto 1", periodStart: day(2026, 10, 1), periodEnd: day(2026, 10, 31), status: "EN_RETARD", dueAt: day(2026, 11, 3) },
          { client: "A", entity: "Resto 1", periodStart: day(2026, 9, 1), periodEnd: day(2026, 9, 30), status: "INCONNU", dueAt: day(2026, 10, 3) },
        ],
      }),
    );
    const ws = wb.getWorksheet("Suivi")!;
    expect((ws.getRow(1).values as string[]).slice(1)).toEqual(["Client", "Entité", "Période", "Statut", "Échéance"]);
    expect([2, 3, 4].map((r) => [ws.getCell(r, 1).value, ws.getCell(r, 3).value, ws.getCell(r, 4).value])).toEqual([
      ["A", "2026-09", "INCONNU"],
      ["A", "2026-10", "En retard"],
      ["B", "2026-10", "Rejeté"],
    ]);
    expect(ws.getCell("E3").value).toEqual(day(2026, 11, 3));
  });

  it("is a valid workbook with an empty consolidated sheet when nothing was accepted", async () => {
    const wb = await open(await buildConsolidatedWorkbook({ template, generatedAt, deposits: [], missing: [] }));
    expect(wb.getWorksheet("Saisie_Restaurant")!.rowCount).toBe(1);
    expect(wb.getWorksheet("Suivi")!.rowCount).toBe(1);
  });
});

describe("zip", () => {
  it("round-trips several files with correct sizes and checksums", () => {
    const zip = createZip([
      { name: "Groupe A/Hôtel 1/octobre.xlsx", data: Buffer.from("premier fichier ".repeat(100)) },
      { name: "b.txt", data: Buffer.alloc(0) },
    ]);
    const files = readZip(zip);
    expect(Object.keys(files)).toEqual(["Groupe A/Hôtel 1/octobre.xlsx", "b.txt"]);
    expect(files["Groupe A/Hôtel 1/octobre.xlsx"]!.toString()).toBe("premier fichier ".repeat(100));
    expect(files["b.txt"]!.length).toBe(0);
  });

  it("makes names safe and unique", () => {
    expect(safeZipName("../../etc/passwd")).toBe("etc/passwd");
    expect(safeZipName("/abs\\path\\file.xlsx")).toBe("abs/path/file.xlsx");
    expect(safeZipName('a<b>c:"d|e?f*.xlsx')).toBe("abcdef.xlsx");
    expect(safeZipName("..")).toBe("fichier");
    expect(safeZipName("   ")).toBe("fichier");
    const files = readZip(createZip([{ name: "a.xlsx", data: Buffer.from("1") }, { name: "A.xlsx", data: Buffer.from("2") }, { name: "a.xlsx", data: Buffer.from("3") }, { name: "noext", data: Buffer.from("4") }, { name: "noext", data: Buffer.from("5") }]));
    expect(Object.keys(files)).toEqual(["a.xlsx", "A (2).xlsx", "a (3).xlsx", "noext", "noext (2)"]);
  });

  it("is reproducible: same input, same bytes, whatever the clock", () => {
    const input = [{ name: "a.txt", data: Buffer.from("x") }];
    expect(createZip(input).equals(createZip(input))).toBe(true);
  });

  it("passes the archive guards used on uploads (a sane ZIP, no macro, no traversal)", () => {
    expect(inspectXlsxArchive(createZip([{ name: "a.xlsx", data: Buffer.from("hello") }]))).toMatchObject({ ok: true, entries: 1 });
  });
});
