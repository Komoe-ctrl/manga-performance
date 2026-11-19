import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_ZIP_FILES, createExportService } from "@/server/collection/export-service";
import type { CollectionActor } from "@/server/collection/scope";
import { createClientCompany, createUser, db, resetDatabase, shutdown } from "./helpers";
import { MemoryStorage } from "./memory-storage";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const actorOf = (u: { id: string; role: CollectionActor["role"]; clientId: string | null }): CollectionActor => ({ userId: u.id, role: u.role, clientId: u.clientId });
const FILTERS = { templateId: "resto_mensuel", from: "2026-10", to: "2026-10" };

let storage: MemoryStorage;
const service = () => createExportService({ prisma: db(), storage, now: () => day(2026, 11, 20) });

async function openWorkbook(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}
const column = (ws: ExcelJS.Worksheet, index: number) => (ws.getColumn(index).values as unknown[]).slice(2);

/** Reads the entry names and contents of a zip written by the platform. */
function unzip(zip: Buffer): Record<string, string> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const rest = zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out[zip.toString("utf8", offset + 46, offset + 46 + nameLength)] = inflateRawSync(zip.subarray(start, start + compressed)).toString();
    offset += 46 + nameLength + rest;
  }
  return out;
}

/** Group A: three restaurants (two deposits accepted, one late). Group B: one restaurant. */
async function seed() {
  const clientA = await createClientCompany("Groupe A");
  const clientB = await createClientCompany("Groupe B");
  let n = 0;
  const entity = (clientId: string, name: string, sector: "RESTAURATION" | "COMMERCE" = "RESTAURATION") => db().entity.create({ data: { clientId, name, sector } });
  const a1 = await entity(clientA.id, "Resto A1");
  const a2 = await entity(clientA.id, "=Resto A2");
  const a3 = await entity(clientA.id, "Resto A3");
  const b1 = await entity(clientB.id, "Resto B1");

  const period = async (entityId: string, status: "VALIDE" | "ACCEPTE_AVEC_RESERVE" | "EN_RETARD" | "REJETE" | "EN_CONTROLE", month = 10) => {
    const plan = await db().collectionPlan.upsert({ where: { entityId_templateId: { entityId, templateId: "resto_mensuel" } }, create: { entityId, templateId: "resto_mensuel", startsOn: day(2026, 1, 1) }, update: {} });
    return db().collectionPeriod.create({ data: { planId: plan.id, periodStart: day(2026, month, 1), periodEnd: day(2026, month + 1, 0), dueAt: day(2026, month + 1, 3), status } });
  };
  const deposit = async (periodId: string, version: number, status: "VALIDE" | "ACCEPTE_AVEC_RESERVE" | "REJETE" | "EN_CONTROLE", caHt: number, name = "depot.xlsx") => {
    n += 1;
    const storageKey = `clients/x/${n}.xlsx`;
    storage.put(storageKey, `fichier ${storageKey}`);
    return db().submission.create({
      data: {
        periodId,
        version,
        templateId: "resto_mensuel",
        templateVersion: 1,
        storageKey,
        originalName: name,
        sizeBytes: 100,
        checksum: "x",
        uploadedBy: "u",
        status,
        rows: { Saisie_Restaurant: [{ caHt, coutMatieres: 1000, chargesPersonnel: 500, autresCharges: 200, nombreCouverts: null }] },
        rowCount: 1,
      },
    });
  };

  const pA1 = await period(a1.id, "VALIDE");
  await deposit(pA1.id, 1, "REJETE", 111);
  await deposit(pA1.id, 2, "VALIDE", 10_000_000, "octobre.xlsx");
  const pA2 = await period(a2.id, "ACCEPTE_AVEC_RESERVE");
  await deposit(pA2.id, 1, "ACCEPTE_AVEC_RESERVE", 8_000_000, "a2.xlsx");
  await period(a3.id, "EN_RETARD");
  const pB1 = await period(b1.id, "VALIDE");
  await deposit(pB1.id, 1, "VALIDE", 5_000_000, "b1.xlsx");

  return {
    clientA,
    clientB,
    a1,
    a2,
    a3,
    b1,
    period,
    deposit,
    admin: await createUser({ role: "ADMIN" }),
    direction: await createUser({ role: "CLIENT_DIRECTION", clientId: clientA.id }),
    analyst: await createUser({ role: "CLIENT_ANALYSTE", clientId: clientA.id }),
    contributor: await createUser({ role: "CLIENT_CONTRIBUTEUR", clientId: clientA.id }),
    directionB: await createUser({ role: "CLIENT_DIRECTION", clientId: clientB.id }),
  };
}

beforeEach(async () => {
  await resetDatabase();
  storage = new MemoryStorage();
});
afterAll(shutdown);

describe("consolidated Excel export of a period over 3 entities", () => {
  it("contains the accepted deposits (latest version) and lists the missing entity in Suivi", async () => {
    const s = await seed();
    const { buffer, filename } = await service().exportWorkbook(actorOf(s.direction), FILTERS);
    expect(filename).toBe("consolidation_resto_mensuel_2026-10.xlsx");
    const wb = await openWorkbook(buffer);

    const ws = wb.getWorksheet("Saisie_Restaurant")!;
    expect(ws.rowCount).toBe(3); // header + A1 + A2: the late entity has no line, the other client is absent
    const lines = [2, 3].map((r) => [ws.getCell(r, 1).value, ws.getCell(r, 2).value, ws.getCell(r, 3).value, ws.getCell(r, 4).value, ws.getCell(r, 5).value, ws.getCell(r, 6).value]);
    expect(lines).toEqual([
      ["Groupe A", "'=Resto A2", "2026-10", 1, "Accepté avec réserve", 8_000_000],
      ["Groupe A", "Resto A1", "2026-10", 2, "Validé", 10_000_000],
    ]);

    const follow = wb.getWorksheet("Suivi")!;
    expect(follow.rowCount).toBe(2);
    expect([follow.getCell("A2").value, follow.getCell("B2").value, follow.getCell("C2").value, follow.getCell("D2").value]).toEqual(["Groupe A", "Resto A3", "2026-10", "En retard"]);
  });

  it("never uses a rejected or in-progress version, and lists a rejected period as missing", async () => {
    const s = await seed();
    const pending = await s.period((await db().entity.create({ data: { clientId: s.clientA.id, name: "Resto A4", sector: "RESTAURATION" } })).id, "EN_CONTROLE");
    await s.deposit(pending.id, 1, "EN_CONTROLE", 999);
    const rejected = await s.period((await db().entity.create({ data: { clientId: s.clientA.id, name: "Resto A5", sector: "RESTAURATION" } })).id, "REJETE");
    await s.deposit(rejected.id, 1, "REJETE", 888);

    const wb = await openWorkbook((await service().exportWorkbook(actorOf(s.admin), FILTERS)).buffer);
    const amounts = column(wb.getWorksheet("Saisie_Restaurant")!, 6);
    expect(amounts).not.toContain(999);
    expect(amounts).not.toContain(888);
    expect(amounts).not.toContain(111);
    const follow = wb.getWorksheet("Suivi")!;
    expect(column(follow, 2).sort()).toEqual(["Resto A3", "Resto A4", "Resto A5"]);
  });

  it("gives the admin every client, with the client column filled in", async () => {
    const s = await seed();
    const wb = await openWorkbook((await service().exportWorkbook(actorOf(s.admin), FILTERS)).buffer);
    const ws = wb.getWorksheet("Saisie_Restaurant")!;
    expect(ws.rowCount).toBe(4);
    expect(column(ws, 1).sort()).toEqual(["Groupe A", "Groupe A", "Groupe B"]);
  });
});

describe("scope", () => {
  it("shows an analyst the same as the direction of their own client, and nothing of another client", async () => {
    const s = await seed();
    for (const user of [s.direction, s.analyst]) {
      const wb = await openWorkbook((await service().exportWorkbook(actorOf(user), FILTERS)).buffer);
      expect(column(wb.getWorksheet("Saisie_Restaurant")!, 1)).not.toContain("Groupe B");
      expect(column(wb.getWorksheet("Suivi")!, 1)).not.toContain("Groupe B");
    }
    const other = await openWorkbook((await service().exportWorkbook(actorOf(s.directionB), FILTERS)).buffer);
    expect(column(other.getWorksheet("Saisie_Restaurant")!, 2)).toEqual(["Resto B1"]);
  });

  it("refuses the contributor", async () => {
    const s = await seed();
    await expect(service().exportWorkbook(actorOf(s.contributor), FILTERS)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service().exportOriginals(actorOf(s.contributor), FILTERS)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a filter only narrow the scope: another client's id or entity yields an empty export, never their data", async () => {
    const s = await seed();
    const empty = async (filters: Record<string, string>) => {
      const wb = await openWorkbook((await service().exportWorkbook(actorOf(s.direction), { ...FILTERS, ...filters })).buffer);
      return [wb.getWorksheet("Saisie_Restaurant")!.rowCount, wb.getWorksheet("Suivi")!.rowCount];
    };
    expect(await empty({ clientId: s.clientB.id })).toEqual([1, 1]);
    expect(await empty({ entityId: s.b1.id })).toEqual([1, 1]);
    expect(await empty({ entityId: "does-not-exist" })).toEqual([1, 1]);
  });

  it("filters by client, entity and sector within the scope", async () => {
    const s = await seed();
    const rows = async (filters: Record<string, string>) => {
      const wb = await openWorkbook((await service().exportWorkbook(actorOf(s.admin), { ...FILTERS, ...filters })).buffer);
      return column(wb.getWorksheet("Saisie_Restaurant")!, 2).sort();
    };
    expect(await rows({ clientId: s.clientB.id })).toEqual(["Resto B1"]);
    expect(await rows({ entityId: s.a1.id })).toEqual(["Resto A1"]);
    expect(await rows({ sector: "RESTAURATION" })).toHaveLength(3);
    expect(await rows({ sector: "COMMERCE" })).toEqual([]);
  });
});

describe("validation", () => {
  it("checks the template, the sector and the month range", async () => {
    const s = await seed();
    const call = (filters: Record<string, string>) => service().exportWorkbook(actorOf(s.admin), { ...FILTERS, ...filters });
    await expect(call({ templateId: "inconnu" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call({ sector: "AUTRE" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call({ from: "octobre" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call({ from: "2026-13" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(call({ from: "2026-10", to: "2026-09" })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("précède") });
    await expect(call({ from: "2024-01", to: "2026-01" })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("24 mois") });
    await expect(call({ from: "2024-02", to: "2026-01" })).resolves.toBeTruthy();
  });

  it("exports a range of months, one block per period", async () => {
    const s = await seed();
    const september = await s.period(s.a1.id, "VALIDE", 9);
    await s.deposit(september.id, 1, "VALIDE", 7_000_000);
    const { buffer, filename } = await service().exportWorkbook(actorOf(s.direction), { ...FILTERS, from: "2026-09", to: "2026-10" });
    expect(filename).toBe("consolidation_resto_mensuel_2026-09_2026-10.xlsx");
    const wb = await openWorkbook(buffer);
    expect(column(wb.getWorksheet("Saisie_Restaurant")!, 3)).toEqual(["2026-09", "2026-10", "2026-10"]);
  });
});

describe("ZIP of the original files", () => {
  it("contains the accepted originals, by client and entity, within the scope", async () => {
    const s = await seed();
    const { buffer, filename, files } = await service().exportOriginals(actorOf(s.direction), FILTERS);
    expect(filename).toBe("originaux_resto_mensuel_2026-10.zip");
    expect(files).toBe(2);
    const entries = unzip(buffer);
    expect(Object.keys(entries).sort()).toEqual(["Groupe A/=Resto A2/2026-10_v1_a2.xlsx", "Groupe A/Resto A1/2026-10_v2_octobre.xlsx"]);
    expect(Object.values(entries).every((content) => content.startsWith("fichier clients/x/"))).toBe(true);
  });

  it("gives the admin every client, and answers 'nothing' with an empty archive", async () => {
    const s = await seed();
    expect((await service().exportOriginals(actorOf(s.admin), FILTERS)).files).toBe(3);
    expect((await service().exportOriginals(actorOf(s.admin), { ...FILTERS, from: "2025-01", to: "2025-01" })).files).toBe(0);
  });

  it("refuses an archive that would be too big, and says to narrow the filters", async () => {
    const s = await seed();
    await db().submission.updateMany({ where: { periodId: { not: "" } }, data: { sizeBytes: 60 * 1024 * 1024 } });
    await expect(service().exportOriginals(actorOf(s.admin), FILTERS)).rejects.toMatchObject({ code: "TOO_LARGE", message: expect.stringContaining("affinez") });
    expect(MAX_ZIP_FILES).toBe(100);
  });
});

describe("audit", () => {
  it("logs every export with the filters and the counts", async () => {
    const s = await seed();
    await service().exportWorkbook(actorOf(s.direction), FILTERS);
    await service().exportOriginals(actorOf(s.direction), FILTERS);
    const log = await db().auditLog.findMany({ where: { action: "collection.export", actorId: s.direction.id }, orderBy: { createdAt: "asc" } });
    expect(log).toHaveLength(2);
    expect(log[0]!.diff).toMatchObject({ kind: "xlsx", templateId: "resto_mensuel", deposits: 2, missing: 1 });
    expect(log[1]!.diff).toMatchObject({ kind: "zip", files: 2 });
  });
});
