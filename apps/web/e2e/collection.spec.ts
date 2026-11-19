import ExcelJS from "exceljs";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { convertToClient, sendLead } from "./support/crm";
import { DATABASE_URL, PASSWORD_FOR_CLIENT } from "./support/env";
import { firstUrl, waitForEmail } from "./support/mailbox";

const COMPANY = "Groupe Collecte E2E";
const DIRECTION_EMAIL = "direction.collecte.e2e@example.com";
const CONTRIBUTOR_EMAIL = "contributeur.collecte.e2e@example.com";
const ENTITY = "Hôtel Collecte E2E";

/** Last month, as the worker's `open-periods` job would have created it (the job runs at 05:00 only). */
async function openLastMonth(entityName: string) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 3));
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const plan = await db.query(`SELECT p.id FROM "CollectionPlan" p JOIN "Entity" e ON e.id = p."entityId" WHERE e.name = $1`, [entityName]);
    const created = await db.query(
      `INSERT INTO "CollectionPeriod" (id, "planId", "periodStart", "periodEnd", "dueAt", status) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'ATTENDU') RETURNING id`,
      [plan.rows[0].id, start, end, due],
    );
    return { id: created.rows[0].id as string, label: new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(start), month: start.toISOString().slice(0, 7) };
  } finally {
    await db.end();
  }
}

/** Fills the downloaded template: one hotel month, with a deliberate mistake when asked. */
async function fillTemplate(path: string, soldRooms: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet("Saisie_Mensuelle")!;
  [40, soldRooms, 45_000_000, 60_000_000, 25_000_000, 12_000_000].forEach((value, i) => (ws.getCell(2, i + 1).value = value));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function acceptInvitation(page: Page, email: string) {
  const invitation = await waitForEmail(email, "/invitation?token=");
  await page.goto(firstUrl(invitation, /https?:\/\/\S+\/invitation\?token=\S+/));
  await page.getByLabel("Nouveau mot de passe").fill(PASSWORD_FOR_CLIENT);
  await page.getByLabel("Confirmer le mot de passe").fill(PASSWORD_FOR_CLIENT);
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByRole("link", { name: "Espace client" })).toBeVisible();
  await page.goto("/espace-client/connexion");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD_FOR_CLIENT);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/espace-client$/);
}

/**
 * Avenant n°1, étape B7 : le consultant prépare l'entité, le plan et le compte du contributeur ; le
 * contributeur dépose un fichier faux (rejet), le corrige (validé) ; le dépôt est visible dans le suivi
 * admin, puis dans l'export consolidé.
 */
test("a contributor deposits, is rejected, corrects, and the deposit shows in the admin follow-up and export", async ({ browser, page, request }) => {
  // --- The consultant sets up the collection --------------------------------------------------------
  await sendLead(request, { name: COMPANY, email: DIRECTION_EMAIL, sector: "Hôtellerie" });
  await convertToClient(page, COMPANY);

  await page.goto("/admin/collecte/entites");
  const entityForm = page.getByRole("form", { name: "Nouvelle entité" }).locator("visible=true");
  await entityForm.getByLabel("Client").selectOption({ label: COMPANY });
  await entityForm.getByLabel(/Nom de l'entité/).fill(ENTITY);
  await entityForm.getByRole("button", { name: /Créer l'entité/ }).click();
  await expect(page.getByText("Entité créée")).toBeVisible();

  const planForm = page.getByRole("form", { name: "Nouveau plan de collecte" }).locator("visible=true");
  await planForm.getByLabel("Entité").selectOption({ label: ENTITY });
  await planForm.getByLabel("Modèle").selectOption({ label: "Hôtel — KPI mensuels" });
  await planForm.getByRole("button", { name: /Créer le plan/ }).click();
  await expect(page.getByText("Plan de collecte créé")).toBeVisible();

  const inviteForm = page.getByRole("form", { name: "Inviter un compte" }).locator("visible=true");
  await inviteForm.getByLabel("Client").selectOption({ label: COMPANY });
  await inviteForm.getByLabel("Nom").fill("Moussa Traoré");
  await inviteForm.getByLabel("Email").fill(CONTRIBUTOR_EMAIL);
  await inviteForm.getByLabel("Rôle").selectOption("CLIENT_CONTRIBUTEUR");
  await inviteForm.getByRole("button", { name: /Inviter/ }).click();
  await expect(page.getByText("Invitation envoyée")).toBeVisible();
  // The box follows the server: it is checked once the assignment is saved, not at the click.
  await page.getByLabel(`Moussa Traoré : ${ENTITY}`).click();
  await expect(page.getByLabel(`Moussa Traoré : ${ENTITY}`)).toBeChecked();

  const { label, month } = await openLastMonth(ENTITY);

  // --- The contributor deposits a wrong file, then the corrected one ---------------------------------
  const clientContext = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fr-FR", acceptDownloads: true });
  const portal = await clientContext.newPage();
  await acceptInvitation(portal, CONTRIBUTOR_EMAIL);

  await portal.goto("/espace-client/collecte");
  const card = portal.getByRole("article").filter({ hasText: ENTITY }).locator("visible=true");
  await expect(card).toContainText(label);

  const [template] = await Promise.all([portal.waitForEvent("download"), card.getByRole("button", { name: "Télécharger le modèle" }).click()]);
  expect(template.suggestedFilename()).toMatch(/^hotel_mensuel_.*\.xlsx$/);
  const templatePath = await template.path();

  // 40 rooms can sell 40 × (days of the month) nights at most: this file claims far more.
  const wrong = await fillTemplate(templatePath, 99_999);
  await card.locator("input[type=file]").setInputFiles({ name: "octobre-faux.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: wrong });
  const toast = portal.locator("[data-sonner-toast]").first();
  await expect(toast).toBeVisible();
  expect(await toast.textContent()).toContain("contrôle en cours");
  await expect(card.getByText(/est supérieur aux chambres disponibles/)).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText(/rejeté/i).first()).toBeVisible();

  const right = await fillTemplate(templatePath, 900);
  await card.locator("input[type=file]").setInputFiles({ name: "octobre-corrige.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: right });
  await expect(portal.getByText("Rien à déposer pour le moment")).toBeVisible({ timeout: 60_000 });

  // A contributor sees nothing but their own entity, and cannot reach the back-office or exports.
  expect((await portal.request.get("/api/exports/prospects")).status()).toBe(403);
  expect((await portal.request.get(`/api/collection/export?templateId=hotel_mensuel&from=${month}&to=${month}`)).status()).toBe(403);
  await clientContext.close();

  // --- The consultant sees it in the follow-up, and exports it --------------------------------------
  await page.goto("/admin/collecte");
  await page.getByRole("button", { name: new RegExp(`${ENTITY}, .*: Validé`) }).locator("visible=true").click();
  const panel = page.getByRole("dialog");
  await expect(panel).toContainText("Version 2");
  await expect(panel).toContainText("octobre-corrige.xlsx");
  await expect(panel).toContainText("Version 1");
  await expect(panel).toContainText("Rejeté");
  await page.keyboard.press("Escape");

  const exported = await page.request.get(`/api/collection/export?templateId=hotel_mensuel&from=${month}&to=${month}`);
  expect(exported.status()).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await exported.body()) as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet("Saisie_Mensuelle")!;
  expect(sheet.getCell("A2").value).toBe(COMPANY);
  expect(sheet.getCell("B2").value).toBe(ENTITY);
  expect(sheet.getCell("C2").value).toBe(month);
  expect(sheet.getCell("D2").value).toBe(2);
  expect(sheet.getCell("F2").value).toBe(40);
  expect(sheet.getCell("G2").value).toBe(900);

  const zip = await page.request.get(`/api/collection/export?templateId=hotel_mensuel&from=${month}&to=${month}&format=zip`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
});
