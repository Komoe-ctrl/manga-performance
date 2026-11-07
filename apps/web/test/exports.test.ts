import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/exports/[kind]/route";
import { createInvoiceService } from "@/server/billing/invoice-service";
import { handleExport } from "@/server/exports/handler";
import { actAs, createClientCompany, createUser, db, login, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});
vi.mock("next/server", () => ({ connection: async () => undefined }));

const NOW = new Date("2026-11-07T10:30:00Z");

beforeEach(async () => {
  await resetDatabase();
  actAs(null);
});
afterAll(shutdown);

const run = (kind: string, query = "", actorId = "admin-1") =>
  handleExport(db(), { kind, searchParams: new URLSearchParams(query), actorId, now: NOW });

async function workbookOf(response: Response) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ArrayBuffer);
  return workbook;
}

const prospect = (companyName: string, extra: Record<string, unknown> = {}) =>
  db().prospect.create({
    data: { companyName, companyNameNorm: companyName.toLowerCase(), sector: "Commerce", source: "MANUEL", ...extra },
  });

describe("authorization", () => {
  const call = (kind = "prospects") => GET(new Request(`http://localhost/api/exports/${kind}`), { params: Promise.resolve({ kind }) });

  it("refuses anonymous visitors", async () => {
    await prospect("Lagune");
    expect((await call()).status).toBe(401);
  });

  it("refuses a client, and an admin without 2FA", async () => {
    const company = await createClientCompany("Acme");
    const client = await createUser({ role: "CLIENT", clientId: company.id });
    actAs((await login(client.email)).cookie);
    expect((await call()).status).toBe(403);

    const admin = await createUser({ role: "ADMIN" });
    actAs((await login(admin.email)).cookie);
    expect((await call()).status).toBe(403);
  });

  it("serves an admin with 2FA and journals the export", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { cookie } = await login(admin.email);
    await db().user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
    actAs(cookie);
    await prospect("Lagune");

    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await response.arrayBuffer();

    const entry = await db().auditLog.findFirstOrThrow({ where: { action: "export.generated" } });
    expect(entry).toMatchObject({ actorId: admin.id, entity: "Export", entityId: "prospects" });
    expect(entry.diff).toMatchObject({ format: "xlsx", rows: 1 });
  });
});

describe("prospects", () => {
  it("applies the filters on the server, like the screen", async () => {
    await prospect("Hôtel Lagune", { status: "NOUVEAU", sector: "Hôtellerie", contactName: "Awa" });
    await prospect("Hôtel Perdu", { status: "PERDU", sector: "Hôtellerie" });
    await prospect("BTP Soro", { status: "NOUVEAU", sector: "BTP" });
    await prospect("Supprimé", { status: "NOUVEAU", sector: "Hôtellerie", deletedAt: new Date() });

    const response = await run("prospects", "format=xlsx&status=nouveau&sector=H%C3%B4tellerie");
    const sheet = (await workbookOf(response)).getWorksheet("Prospects")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Entreprise");
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(2).getCell(1).value).toBe("Hôtel Lagune");
    expect(sheet.getRow(2).getCell(8).value).toBe("Nouveau");
  });

  it("searches like the screen (company, contact, email, sector, city)", async () => {
    await prospect("Alpha", { contactName: "Kouassi" });
    await prospect("Beta", { email: "kouassi@example.com" });
    await prospect("Gamma");
    const sheet = (await workbookOf(await run("prospects", "q=KOUASSI"))).getWorksheet("Prospects")!;
    expect(sheet.rowCount).toBe(3);
  });

  it("shows an unknown size as PME, as the screen does", async () => {
    await prospect("Sans taille");
    await prospect("Petite", { size: "TPE" });
    const sheet = (await workbookOf(await run("prospects", "size=pme"))).getWorksheet("Prospects")!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(2).getCell(1).value).toBe("Sans taille");
  });

  it("lists the filters in a second sheet", async () => {
    await prospect("Lagune");
    const info = (await workbookOf(await run("prospects", "status=nouveau"))).getWorksheet("Filtres")!;
    const text = JSON.stringify(info.getSheetValues());
    expect(text).toContain("Statut : Nouveau");
    expect(text).toContain("07/11/2026 10:30");
  });

  it("never turns a collected value into a formula", async () => {
    await prospect('=HYPERLINK("http://evil.example","clic")', { contactName: "@SUM(1+1)", notes: "+cmd" });
    const sheet = (await workbookOf(await run("prospects"))).getWorksheet("Prospects")!;
    for (const column of [1, 2]) {
      const cell = sheet.getRow(2).getCell(column);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(cell.formula).toBeUndefined();
    }
    expect(sheet.getRow(2).getCell(1).value).toBe('=HYPERLINK("http://evil.example","clic")');
  });

  it("produces a PDF with the same data", async () => {
    await prospect("Lagune");
    const response = await run("prospects", "format=pdf");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="prospects-2026-11-07.pdf"');
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("invoices", () => {
  it("exports amounts as integers and applies status and date filters", async () => {
    const company = await createClientCompany("Lagune Hôtel");
    const admin = await createUser({ role: "ADMIN" });
    const billing = createInvoiceService({ prisma: db(), queue: { enqueueEmail: async () => undefined }, appUrl: "https://app.example.com" });
    const issued = await billing.createDraft({ clientId: company.id, lines: [{ label: "Audit", quantity: 100, unitPrice: 500_000 }] }, admin.id);
    await billing.issue(issued, admin.id);
    await billing.createDraft({ clientId: company.id, lines: [{ label: "Brouillon", quantity: 100, unitPrice: 1_000 }] }, admin.id);

    const all = (await workbookOf(await run("invoices"))).getWorksheet("Factures")!;
    expect(all.rowCount).toBe(3);

    const issuedOnly = (await workbookOf(await run("invoices", "status=en_attente"))).getWorksheet("Factures")!;
    expect(issuedOnly.rowCount).toBe(2);
    const row = issuedOnly.getRow(2);
    expect(row.getCell(3).value).toBe("Lagune Hôtel");
    expect(row.getCell(6).value).toBe(500_000);
    expect(row.getCell(7).value).toBe(90_000);
    expect(row.getCell(8).value).toBe(590_000);
    expect(row.getCell(10).value).toBe(590_000);

    const future = (await workbookOf(await run("invoices", "from=2999-01-01"))).getWorksheet("Factures")!;
    expect(future.rowCount).toBe(1);
  });
});

describe("subscribers and scrape results", () => {
  it("filters subscribers by state and never exports the consent IP", async () => {
    const at = new Date("2026-11-01T08:00:00Z");
    await db().newsletterSubscriber.createMany({
      data: [
        { email: "ok@example.com", confirmedAt: at, consentIp: "203.0.113.9" },
        { email: "wait@example.com" },
        { email: "gone@example.com", confirmedAt: at, unsubscribedAt: at },
      ],
    });
    const sheet = (await workbookOf(await run("subscribers", "status=confirme"))).getWorksheet("Abonnés à la newsletter")!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(2).getCell(1).value).toBe("ok@example.com");

    const everything = JSON.stringify((await workbookOf(await run("subscribers"))).getWorksheet("Abonnés à la newsletter")!.getSheetValues());
    expect(everything).not.toContain("203.0.113.9");
  });

  it("exports the results of one job, with duplicates flagged", async () => {
    const job = await db().scrapeJob.create({ data: { source: "ANNUAIRE", filters: {}, status: "DONE", createdBy: "admin-1" } });
    const known = await prospect("Existant");
    await db().scrapeResult.createMany({
      data: [
        { jobId: job.id, companyName: "Nouveau", companyNameNorm: "nouveau", sourceUrl: "http://x.test/1", collectedAt: NOW },
        { jobId: job.id, companyName: "Existant", companyNameNorm: "existant", sourceUrl: "http://x.test/2", collectedAt: NOW, duplicateOfProspectId: known.id },
      ],
    });
    const sheet = (await workbookOf(await run("scrape-results", `jobId=${job.id}`))).getWorksheet("Résultats de scraping")!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(3).getCell(7).value).toBe("Oui");
  });
});

describe("refusals", () => {
  it.each([
    ["unknown kind", "secrets", "", 404],
    ["unknown format", "prospects", "format=docx", 400],
    ["unknown status", "prospects", "status=hacked", 400],
    ["bad date", "invoices", "from=yesterday", 400],
    ["missing job", "scrape-results", "", 400],
    ["job that does not exist", "scrape-results", "jobId=nope", 404],
  ])("%s", async (_name, kind, query, status) => {
    const response = await run(kind, query);
    expect(response.status).toBe(status);
    expect(await db().auditLog.count({ where: { action: "export.generated" } })).toBe(0);
  });

  it("ignores filters that do not belong to the export", async () => {
    await prospect("Lagune");
    const response = await run("prospects", "jobId=x&clientId=y");
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });
});
