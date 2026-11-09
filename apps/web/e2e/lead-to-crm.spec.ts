import { expect, test } from "@playwright/test";
import pg from "pg";
import { DATABASE_URL } from "./support/env";

/** Scenario 1 (spec, section 10): a visitor writes through the contact form, the consultant sees the prospect. */
test("a contact-form message becomes a prospect visible in the back-office", async ({ browser, page }) => {
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fr-FR" });
  const site = await visitor.newPage();
  // The Turnstile widget is replaced by one that hands out a token at once (the server-side check is stubbed too).
  await site.route("**/turnstile/v0/api.js*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.turnstile={render:(el,o)=>{setTimeout(()=>o.callback(\"e2e-token\"),50);return \"w1\"},reset(){},remove(){}};",
    }),
  );
  await site.goto("/contact");

  await site.getByLabel("Nom *").fill("Koffi Konan E2E");
  await site.getByLabel("Email *").fill("koffi.e2e@example.com");
  await site.getByLabel("Téléphone").fill("+225 07 01 02 03 04");
  await site.getByLabel("Secteur *").selectOption("Hôtellerie");
  await site.getByLabel("Message *").fill("Nous voulons un tableau de bord de gestion pour notre hôtel.");
  await site.getByRole("checkbox").check();

  // The invisible Turnstile widget (Cloudflare's test key) issues a token a moment after load.
  await expect(async () => {
    await site.getByRole("button", { name: "Envoyer" }).click();
    await expect(site.getByRole("status")).toContainText("Message envoyé", { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await visitor.close();

  // The consultant (signed in through the setup project) finds the prospect, with its consent recorded.
  await page.goto("/admin/prospects");
  await page.getByRole("searchbox", { name: "Recherche", exact: true }).fill("Koffi Konan E2E");
  const row = page.getByRole("row", { name: /Koffi Konan E2E/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Nouveau");
  await row.getByRole("link", { name: "Koffi Konan E2E" }).click();
  await expect(page.getByText("koffi.e2e@example.com")).toBeVisible();
  await expect(page.getByText("+2250701020304")).toBeVisible();
});

/** Regression: visually hidden labels inside the scrolling columns once stretched the page far below the board. */
test("the kanban board does not leave a blank page below it", async ({ page }) => {
  // Enough cards in one column for it to scroll on its own.
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  for (let i = 0; i < 14; i++) {
    await db.query(
      `INSERT INTO "Prospect" (id, "companyName", "companyNameNorm", sector, source, status, "updatedAt") VALUES ($1, $2, $3, 'Commerce', 'MANUEL', 'NOUVEAU', now())`,
      [`e2e-kanban-${i}`, `Carte ${i}`, `carte ${i}`],
    );
  }
  await db.end();

  await page.goto("/admin/prospects");
  await page.getByRole("button", { name: "Kanban" }).click();
  await expect(page.getByRole("region", { name: "Nouveau" })).toBeVisible();
  const { document: documentHeight, layout } = await page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    layout: Math.round(document.querySelector("main")!.getBoundingClientRect().bottom + window.scrollY),
  }));
  expect(documentHeight - layout).toBeLessThan(80);
});

test("a card moved with its select lands in the new column", async ({ page }) => {
  await page.goto("/admin/prospects");
  await page.getByRole("button", { name: "Kanban" }).click();
  const card = page.getByRole("region", { name: "Nouveau" }).getByRole("listitem").filter({ hasText: "Carte 0" });
  await expect(card).toBeVisible();
  await expect(async () => {
    await card.getByLabel("Statut de Carte 0").selectOption("en_negociation");
    await expect(page.getByRole("region", { name: "En négociation" }).getByText("Carte 0")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 40_000 });
});

test("settings tell whether there is something to save", async ({ page }) => {
  await page.goto("/admin/parametres");
  const name = page.getByLabel("Nom", { exact: true });
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  await expect(async () => {
    await name.fill("Cabinet E2E");
    await expect(page.getByText("Modifications non enregistrées")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 40_000 });
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Paramètres enregistrés")).toBeVisible();
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
});
