"use server";

import { referenceInputSchema, testimonialInputSchema, uploadRequestSchema } from "@manga/validation";
import { z } from "zod";
import { createLogger } from "@manga/core";
import { DomainError } from "../domain-error";
import { getReferences } from "../references/instance";
import { parseInput, runAdmin, type Result } from "./result";

const idSchema = z.string().min(1).max(64);
const logger = createLogger({ service: "web" });
const optionalId = (id: unknown) => (id === null || id === undefined ? undefined : parseInput(idSchema, id));

// ---- back-office (every action starts with `requireAdmin()` through `runAdmin`) -------

export async function listReferencesAction() {
  return runAdmin(() => getReferences().listReferences());
}

export async function saveReferenceAction(id: unknown, input: unknown) {
  return runAdmin((admin) => getReferences().saveReference(parseInput(referenceInputSchema, input), admin.userId, optionalId(id)));
}

export async function deleteReferenceAction(id: unknown) {
  return runAdmin(async (admin) => {
    await getReferences().removeReference(parseInput(idSchema, id), admin.userId);
    return { deleted: true };
  });
}

export async function requestReferenceLogoUploadAction(input: unknown) {
  return runAdmin(() => getReferences().requestLogoUpload(parseInput(uploadRequestSchema, input)));
}

export async function listTestimonialsAction() {
  return runAdmin(() => getReferences().listTestimonials());
}

export async function saveTestimonialAction(id: unknown, input: unknown) {
  return runAdmin((admin) => getReferences().saveTestimonial(parseInput(testimonialInputSchema, input), admin.userId, optionalId(id)));
}

export async function deleteTestimonialAction(id: unknown) {
  return runAdmin(async (admin) => {
    await getReferences().removeTestimonial(parseInput(idSchema, id), admin.userId);
    return { deleted: true };
  });
}

// ---- public site: published and authorized content only, no session needed ----------

async function runPublic<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, code: error.code, error: error.message };
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "public action failure");
    return { ok: false, code: "INTERNAL", error: "Une erreur est survenue." };
  }
}

export async function listPublicReferencesAction() {
  return runPublic(() => getReferences().listPublicReferences());
}

export async function listPublicTestimonialsAction() {
  return runPublic(() => getReferences().listPublicTestimonials());
}
