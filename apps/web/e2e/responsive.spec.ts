import { expect, test } from "@playwright/test";

/** No page may scroll sideways on a phone: a wide table or a fixed-width block would show up here. */
const PAGES = ["/", "/a-propos", "/services", "/services/business-plan-bancable", "/references", "/blog", "/contact", "/demo", "/mentions-legales", "/confidentialite", "/espace-client/connexion", "/admin/connexion", "/inexistante"];

test.use({ viewport: { width: 390, height: 844 } });

for (const path of PAGES) {
  test(`${path} does not overflow horizontally on a phone`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
