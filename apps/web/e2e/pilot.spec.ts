import ExcelJS from "exceljs";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { convertToClient, sendLead } from "./support/crm";
import { DATABASE_URL, PASSWORD_FOR_CLIENT } from "./support/env";
import { firstUrl, waitForEmail } from "./support/mailbox";

const COMPANY = "Groupe Pilote E2E";
const DIRECTION_EMAIL = "direction.pilote.e2e@example.com";
const CONTRIBUTOR_EMAIL = "contributeur.pilote.e2e@example.com";
const ENTITY = "Hôtel Pilote E2E";
const PRODUCT = "Papier hygiénique Pilote";

/** Opens last month for the CPRO plan, as the worker would a few minutes after midnight. */
async function openLastMonth(entityName: string) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 3));
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const plan = await db.query(
      `SELECT p.id FROM "CollectionPlan" p JOIN "Entity" e ON e.id = p."entityId" WHERE e.name = $1 AND p."templateId" = 'hotel_consommables_cpro'`,
      [entityName],
    );
    expect(plan.rows[0], "CPRO plan must exist before opening a period").toBeTruthy();
    const created = await db.query(
      `INSERT INTO "CollectionPeriod" (id, "planId", "periodStart", "periodEnd", "dueAt", status) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'ATTENDU') RETURNING id`,
      [plan.rows[0].id, start, end, due],
    );
    const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
    return { id: created.rows[0].id as string, start, label, month: start.toISOString().slice(0, 7) };
  } finally {
    await db.end();
  }
}

/** An anonymised catalogue: 1 unité/client, 1 FCFA/unité, complete conversion, default coverage bounds. */
async function seedCpraCatalogue() {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const client = await db.query(`SELECT id FROM "Client" WHERE "legalName" = $1`, [COMPANY]);
    const entity = await db.query(`SELECT id FROM "Entity" WHERE name = $1`, [ENTITY]);
    expect(client.rows[0], "client must be converted before seeding its catalogue").toBeTruthy();
    expect(entity.rows[0], "entity must exist before seeding its catalogue").toBeTruthy();
    const product = await db.query(
      `INSERT INTO "ClientProduct" (id, "clientId", code, label, "referenceUnit", active)
       VALUES (gen_random_uuid()::text, $1, 'PHP-PIL', $2, 'unite', true) RETURNING id`,
      [client.rows[0].id, PRODUCT],
    );
    const productId = product.rows[0].id as string;
    await db.query(`INSERT INTO "ProductConversion" (id, "productId", "deliveryUnit", factor) VALUES (gen_random_uuid()::text, $1, 'Rouleau', 1)`, [productId]);
    await db.query(
      `INSERT INTO "CpraNorm" (id, "productId", "entityId", "validFrom", "normPerClient", "nonUserRate", "unitCostFcfa")
       VALUES (gen_random_uuid()::text, $1, NULL, $2, 1, 0, 1000)`,
      [productId, new Date(Date.UTC(2020, 0, 1))],
    );
  } finally {
    await db.end();
  }
}

/** 100 clients, 120 rouleaux livrés : CPRA 100, CPRO 120, couverture 120 %, écart valorisé 20 000 FCFA. */
async function fillCproTemplate(path: string, periodStart: Date): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const delivered = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 15));
  const cpro = wb.getWorksheet("Saisie_CPRO")!;
  [PRODUCT, "Rouleau", 120, delivered, "BL-PILOTE-001", "Livraison fictive"].forEach((value, i) => (cpro.getCell(2, i + 1).value = value));
  const population = wb.getWorksheet("Population")!;
  [100, 100, 0].forEach((value, i) => (population.getCell(2, i + 1).value = value));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function waitForComputedVersion(periodId: string): Promise<number> {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const deadline = Date.now() + 60_000;
  try {
    while (Date.now() < deadline) {
      const result = await db.query(`SELECT DISTINCT version FROM "CpraResult" WHERE "periodId" = $1 ORDER BY version DESC`, [periodId]);
      if (result.rows[0]) return result.rows[0].version as number;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Le calcul CPRA n'a pas produit de résultat dans les 60 secondes.");
  } finally {
    await db.end();
  }
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

async function invite(page: Page, email: string, role: string, name: string) {
  const form = page.getByRole("form", { name: "Inviter un compte" }).locator("visible=true");
  await form.getByLabel("Client").selectOption({ label: COMPANY });
  await form.getByLabel("Nom").fill(name);
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Rôle").selectOption(role);
  await form.getByRole("button", { name: /Inviter/ }).click();
  await expect(page.getByText("Invitation envoyée")).toBeVisible();
  // Seuls les contributeurs ont des affectations ; la direction voit toutes les entités du client.
  if (role === "CLIENT_CONTRIBUTEUR") {
    await page.getByLabel(`${name} : ${ENTITY}`).click();
    await expect(page.getByLabel(`${name} : ${ENTITY}`)).toBeChecked();
  }
}

/**
 * Avenant n°1, étape B10 : dépôt CPRO + population, écarts calculés par le moteur, validation du consultant,
 * puis visibilité côté client. Le contributeur ne voit jamais le pilote.
 */
test("a CPRO deposit becomes visible to the client only after the consultant validates it", async ({ browser, page, request }) => {
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
  await planForm.getByLabel("Modèle").selectOption({ label: "Hôtel — Consommables (CPRO) et population" });
  await planForm.getByRole("button", { name: /Créer le plan/ }).click();
  await expect(page.getByText("Plan de collecte créé")).toBeVisible();

  await seedCpraCatalogue();
  await invite(page, CONTRIBUTOR_EMAIL, "CLIENT_CONTRIBUTEUR", "Contributeur Pilote");
  await invite(page, DIRECTION_EMAIL, "CLIENT_DIRECTION", "Direction Pilote");
  const period = await openLastMonth(ENTITY);

  // --- Dépôt du contributeur ----------------------------------------------------------------------------
  const contributorContext = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fr-FR", acceptDownloads: true });
  const contributor = await contributorContext.newPage();
  await acceptInvitation(contributor, CONTRIBUTOR_EMAIL);
  await contributor.goto("/espace-client/collecte");
  const card = contributor.getByRole("article").filter({ hasText: ENTITY }).locator("visible=true");
  await expect(card).toContainText(period.label);
  const [template] = await Promise.all([contributor.waitForEvent("download"), card.getByRole("button", { name: "Télécharger le modèle" }).click()]);
  const filled = await fillCproTemplate((await template.path())!, period.start);
  await card.locator("input[type=file]").setInputFiles({ name: "cpro-pilote.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: filled });
  await expect(contributor.getByText("Rien à déposer pour le moment")).toBeVisible({ timeout: 60_000 });
  // Le contributeur ne reçoit aucun résultat : le pilote n'existe pas dans son espace.
  await expect(contributor.getByRole("region", { name: "Pilote hôtellerie" })).toHaveCount(0);
  expect(await waitForComputedVersion(period.id)).toBe(1);
  await contributorContext.close();

  // --- Avant validation : la direction ne voit rien ----------------------------------------------------
  const directionContext = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "fr-FR" });
  const direction = await directionContext.newPage();
  await acceptInvitation(direction, DIRECTION_EMAIL);
  await direction.goto("/espace-client/collecte");
  const clientPilot = direction.getByRole("region", { name: "Pilote hôtellerie" });
  await expect(clientPilot).toContainText("Aucun résultat validé pour le moment");

  // --- Validation du consultant -------------------------------------------------------------------------
  await page.goto("/admin/collecte/pilote");
  await page.getByLabel("Client").selectOption({ label: COMPANY });
  const adminRow = page.locator("tbody tr").filter({ hasText: ENTITY }).first();
  await expect(adminRow).toContainText("v1");
  await adminRow.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Résultats validés : visibles dans l'espace client.")).toBeVisible();
  await expect(adminRow.getByText("Validé", { exact: true })).toBeVisible();

  // --- Après validation : les écarts apparaissent côté client, en lecture seule ------------------------
  await direction.reload();
  await expect(clientPilot).toContainText(PRODUCT);
  await expect(clientPilot).toContainText("Total des écarts valorisés");
  await expect(clientPilot).toContainText("20 000 FCFA");
  await directionContext.close();
});
