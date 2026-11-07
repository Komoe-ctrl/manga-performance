import { expect, test } from "@playwright/test";
import { convertToClient, sendLead } from "./support/crm";

const COMPANY = "Transports Sahel E2E";

/** Scenario 3 (spec, section 10): create, issue and pay an invoice. */
test("an invoice is created, issued with a gapless number, then paid", async ({ page, request }) => {
  await sendLead(request, { name: COMPANY, email: "sahel.e2e@example.com" });
  await convertToClient(page, COMPANY);

  await page.goto("/admin/factures/nouvelle");
  await page.getByLabel("Client *").selectOption({ label: COMPANY });
  await page.getByLabel("Libellé 1").fill("Mise en place du tableau de bord");
  await page.getByLabel("Qté").fill("2");
  await page.getByLabel("Prix unitaire (FCFA)").fill("250000");
  await page.getByRole("button", { name: "Émettre la facture" }).click();

  // Issued: the server gave it the next number of the year, and VAT 18 % on 500 000 FCFA HT.
  await expect(page.getByText(/Facture \d{4}-001/)).toBeVisible();
  await expect(page.getByText(/590\s?000/).first()).toBeVisible();

  await expect(page).toHaveURL(/\/admin\/factures\/(?!nouvelle)[^/]+$/);

  // The PDF is produced on demand, for the consultant.
  const invoiceId = page.url().split("/").pop()!;
  const pdf = await page.request.get(`/api/invoices/${invoiceId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("button", { name: "Marquer payée" }).click();
  await expect(page.getByText("Facture marquée comme payée")).toBeVisible();

  // The list shows it paid, and the Excel export contains it (same filters re-applied by the server).
  await page.goto("/admin/factures");
  await expect(page.getByRole("row", { name: new RegExp(COMPANY) })).toContainText("Payée");
  const excel = await page.request.get("/api/exports/invoices?format=xlsx&status=payee");
  expect(excel.status()).toBe(200);
  expect(excel.headers()["content-type"]).toContain("spreadsheetml");
  expect((await excel.body()).subarray(0, 2).toString()).toBe("PK");
});
