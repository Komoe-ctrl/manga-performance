import { expect, test } from "@playwright/test";

/** Scenario 1 (spec, section 10): a visitor writes through the contact form, the consultant sees the prospect. */
test("a contact-form message becomes a prospect visible in the back-office", async ({ browser, page }) => {
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fr-FR" });
  const site = await visitor.newPage();
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
