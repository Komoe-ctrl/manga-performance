import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/exports/demo/route";
import { LIMITS } from "@/server/auth/rate-limit";
import { resetDatabase, shutdown } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => undefined }));

beforeEach(resetDatabase);
afterAll(shutdown);

const call = (query = "", ip = "198.51.100.7") =>
  GET(new Request(`http://localhost/api/exports/demo?${query}`, { headers: { "x-forwarded-for": ip } }));

async function sheetOf(response: Response) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ArrayBuffer);
  return workbook;
}

describe("GET /api/exports/demo (public, fictitious data)", () => {
  it("needs no session and returns twelve months of the shared dataset", async () => {
    const response = await call("format=xlsx");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    const workbook = await sheetOf(response);
    const sheet = workbook.getWorksheet("Dashboard de démonstration")!;
    expect(sheet.rowCount).toBe(13);
    expect(sheet.getRow(1).getCell(2).value).toBe("Chiffre d'affaires (FCFA)");
    expect(typeof sheet.getRow(2).getCell(2).value).toBe("number");
    expect(JSON.stringify(workbook.getWorksheet("Filtres")!.getSheetValues())).toContain("Données fictives");
  });

  it("applies the same filters as the screen", async () => {
    const all = (await sheetOf(await call("hotelId=all"))).getWorksheet("Dashboard de démonstration")!;
    const one = (await sheetOf(await call("hotelId=h1&productId=chambres&granularity=mois"))).getWorksheet("Dashboard de démonstration")!;
    expect(one.getRow(2).getCell(2).value).toBeLessThan(all.getRow(2).getCell(2).value as number);
    const text = JSON.stringify((await sheetOf(await call("hotelId=h2&granularity=annee"))).getWorksheet("Filtres")!.getSheetValues());
    expect(text).toContain("Résidence Les Palmes");
    expect(text).toContain("Dernière année");
  });

  it("produces a PDF", async () => {
    const response = await call("format=pdf");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it.each(["format=docx", "hotelId=h999", "productId=x", "granularity=decade"])("refuses %s", async (query) => {
    expect((await call(query)).status).toBe(400);
  });

  it("is rate limited per IP", async () => {
    for (let i = 0; i < LIMITS.demoExportIp.points; i++) expect((await call("hotelId=bad", "203.0.113.50")).status).toBe(400);
    const limited = await call("", "203.0.113.50");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another visitor is unaffected.
    expect((await call("", "203.0.113.51")).status).toBe(200);
  });
});
