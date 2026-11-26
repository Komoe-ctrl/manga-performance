"use server";

import { toPublicProfile } from "@/lib/content/public-profile";
import { getPrisma } from "../db";
import { createSettingsRepository } from "../repositories/settings";
import { runPublic } from "./result";

// ---- public site: only what the cabinet provided, never the rest of the settings (VAT, bank details…) ----------

export async function getPublicProfileAction() {
  return runPublic(async () => toPublicProfile(await createSettingsRepository(getPrisma()).get()));
}
