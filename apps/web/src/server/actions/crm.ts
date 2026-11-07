"use server";

import {
  addFollowUpSchema,
  addInteractionSchema,
  createProspectSchema,
  settingsSchema,
  updateProspectStatusSchema,
} from "@manga/validation";
import { z } from "zod";
import { getCrm } from "../crm/instance";
import { parseInput, runAdmin } from "./result";

const idSchema = z.string().min(1).max(64);

// Every action goes through `runAdmin`, which calls `requireAdmin()` *before* anything
// else, including input validation (spec, section 5).

export async function listProspectsAction() {
  return runAdmin(() => getCrm().listProspects());
}

export async function getProspectAction(id: unknown) {
  return runAdmin(() => getCrm().getProspect(parseInput(idSchema, id)));
}

export async function createProspectAction(input: unknown) {
  return runAdmin((admin) =>
    getCrm().createProspect(parseInput(createProspectSchema, input), admin.userId),
  );
}

export async function updateProspectStatusAction(input: unknown) {
  return runAdmin((admin) => {
    const data = parseInput(updateProspectStatusSchema, input);
    return getCrm().updateProspectStatus(
      data.id,
      data.status,
      { createAccess: data.createAccess },
      admin.userId,
    );
  });
}

export async function listInteractionsAction(prospectId: unknown) {
  return runAdmin(() => getCrm().listInteractions(parseInput(idSchema, prospectId)));
}

export async function addInteractionAction(input: unknown) {
  return runAdmin((admin) =>
    getCrm().addInteraction(parseInput(addInteractionSchema, input), admin.userId),
  );
}

export async function listFollowUpsAction() {
  return runAdmin(() => getCrm().listFollowUps());
}

export async function addFollowUpAction(input: unknown) {
  return runAdmin(() => getCrm().addFollowUp(parseInput(addFollowUpSchema, input)));
}

export async function completeFollowUpAction(id: unknown) {
  return runAdmin(() => getCrm().completeFollowUp(parseInput(idSchema, id)));
}

export async function listClientsAction() {
  return runAdmin(() => getCrm().listClients());
}

export async function setClientAccessAction(clientId: unknown, active: unknown) {
  return runAdmin((admin) =>
    getCrm().setClientAccess(
      parseInput(idSchema, clientId),
      parseInput(z.boolean(), active),
      admin.userId,
    ),
  );
}

export async function getSettingsAction() {
  return runAdmin(() => getCrm().getSettings());
}

export async function saveSettingsAction(input: unknown) {
  return runAdmin((admin) =>
    getCrm().saveSettings(parseInput(settingsSchema, input), admin.userId),
  );
}
