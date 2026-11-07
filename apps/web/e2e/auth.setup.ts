import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./support/env";
import { totp } from "./support/totp";

/**
 * The consultant's first login, exactly as in production: single-use invitation link from the
 * seed, password, mandatory 2FA enrolment. The session is then reused by every scenario.
 */
setup("the consultant activates the account and signs in with 2FA", async ({ page }) => {
  const invitation = readFileSync(resolve(__dirname, ".state/admin-invitation.txt"), "utf8").trim();
  await page.goto(invitation);
  await page.getByLabel("Nouveau mot de passe").fill(ADMIN_PASSWORD);
  await page.getByLabel("Confirmer le mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByRole("link", { name: "Back-office" })).toBeVisible();

  await page.goto("/admin/connexion");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // Not enrolled yet: the app forces the 2FA enrolment screen.
  await expect(page).toHaveURL(/\/admin\/securite/);
  await page.locator("#setup-password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continuer" }).click();
  const secret = (await page.locator("code").first().innerText()).trim();
  await page.getByLabel("Code à 6 chiffres").fill(totp(secret));
  await page.getByRole("button", { name: /Activer|Valider|Terminer/ }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.context().storageState({ path: resolve(__dirname, ".state/admin.json") });
});
