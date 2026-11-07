import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { BASE_URL } from "./env";

/** A visitor's lead, sent the way the public forms send it (Cloudflare's test key accepts any token). */
export async function sendLead(request: APIRequestContext, lead: { name: string; email: string; sector?: string }) {
  const response = await request.post("/api/leads", {
    headers: { origin: BASE_URL },
    data: {
      source: "site_formulaire",
      name: lead.name,
      email: lead.email,
      sector: lead.sector ?? "Services",
      message: "Demande créée par le test e2e.",
      consent: true,
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** The consultant converts the prospect into a client; the invitation email is sent by the worker. */
export async function convertToClient(admin: Page, companyName: string) {
  await admin.goto("/admin/prospects");
  await admin.getByRole("searchbox", { name: "Recherche", exact: true }).fill(companyName);
  await admin.getByRole("row", { name: new RegExp(companyName) }).getByRole("link", { name: companyName }).click();
  await expect(admin.getByRole("heading", { name: companyName })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Anonymiser" })).toBeVisible();
  // In development the page may not be hydrated yet when the first change is made: retry.
  await expect(async () => {
    // Cache Components keeps the previous page mounted but hidden: only the visible select counts.
    await admin.getByLabel("Statut").locator("visible=true").selectOption("client");
    await expect(admin.getByText("Statut : Client")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 40_000 });
}
