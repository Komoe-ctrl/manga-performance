import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { convertToClient, sendLead } from "./support/crm";
import { PASSWORD_FOR_CLIENT } from "./support/env";
import { firstUrl, waitForEmail } from "./support/mailbox";

const COMPANY = "Hôtel Ebène E2E";
const EMAIL = "ebene.e2e@example.com";
const REPORT = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n", "latin1");

/** Scenario 2 (spec, section 10): conversion, invitation, client login, download of a deliverable. */
test("a converted prospect is invited, signs in and downloads a deliverable", async ({ browser, page, request }) => {
  await sendLead(request, { name: COMPANY, email: EMAIL });
  await convertToClient(page, COMPANY);

  // The consultant publishes a report for the client.
  await page.goto("/admin/clients");
  await page.getByRole("row", { name: new RegExp(COMPANY) }).getByRole("button", { name: "Publier un livrable" }).click();
  await page.getByLabel("Titre *").fill("Rapport de gestion T3");
  await page.getByLabel(/Fichier \*/).setInputFiles({ name: "rapport-t3.pdf", mimeType: "application/pdf", buffer: REPORT });
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(page.getByText("Livrable publié dans l'espace client")).toBeVisible();

  // The worker emailed the invitation: the client follows the single-use link and chooses a password.
  const invitation = await waitForEmail(EMAIL, "/invitation?token=");
  const link = firstUrl(invitation, /https?:\/\/\S+\/invitation\?token=\S+/);
  const client = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fr-FR", acceptDownloads: true });
  const portal = await client.newPage();
  await portal.goto(link);
  await portal.getByLabel("Nouveau mot de passe").fill(PASSWORD_FOR_CLIENT);
  await portal.getByLabel("Confirmer le mot de passe").fill(PASSWORD_FOR_CLIENT);
  await portal.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(portal.getByRole("link", { name: "Espace client" })).toBeVisible();

  await portal.goto("/espace-client/connexion");
  await portal.getByLabel("Email").fill(EMAIL);
  await portal.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD_FOR_CLIENT);
  await portal.getByRole("button", { name: "Se connecter" }).click();
  await expect(portal).toHaveURL(/\/espace-client$/);

  // The client sees the deliverable and downloads the exact file through a short-lived signed link.
  await expect(portal.getByText("Rapport de gestion T3")).toBeVisible();
  const [download] = await Promise.all([portal.waitForEvent("download"), portal.getByRole("button", { name: "Télécharger" }).first().click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(readFileSync(await download.path())).toEqual(REPORT);

  // A wrongly chosen attachment can be removed before sending, and a forbidden type is refused on the spot.
  await portal.goto("/espace-client/messages");
  await portal.locator("input[type=file]").setInputFiles({ name: "mauvais-fichier.pdf", mimeType: "application/pdf", buffer: REPORT });
  await expect(portal.getByTestId("attachment-chip")).toContainText("mauvais-fichier.pdf");
  await portal.getByRole("button", { name: /Retirer la pièce jointe/ }).click();
  await expect(portal.getByTestId("attachment-chip")).toHaveCount(0);
  await portal.locator("input[type=file]").setInputFiles({ name: "programme.exe", mimeType: "application/octet-stream", buffer: Buffer.alloc(8) });
  await expect(portal.getByText("Format non accepté")).toBeVisible();
  await expect(portal.getByTestId("attachment-chip")).toHaveCount(0);

  // The client has no way into the back-office.
  const forbidden = await portal.request.get("/api/exports/prospects");
  expect(forbidden.status()).toBe(403);
  await client.close();
});
