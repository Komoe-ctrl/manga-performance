"use server";

import { z } from "zod";
import { getPrivacy } from "../privacy/instance";
import { parseInput, runAdmin } from "./result";

const idSchema = z.string().min(1).max(64);
// Irreversible: the caller must say so explicitly.
const anonymizeSchema = z.object({ id: idSchema, confirm: z.literal(true) });

export async function exportContactDataAction(prospectId: unknown) {
  return runAdmin(async (admin) => {
    const data = await getPrivacy().exportContact(parseInput(idSchema, prospectId), admin.userId);
    // Plain JSON for the browser: dates are already ISO strings.
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  });
}

export async function anonymizeContactAction(input: unknown) {
  return runAdmin((admin) => {
    const data = parseInput(anonymizeSchema, input);
    return getPrivacy().anonymizeContact(data.id, admin.userId);
  });
}
