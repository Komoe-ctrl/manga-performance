"use server";

import { blogPostInputSchema, sequenceInputSchema, uploadRequestSchema } from "@manga/validation";
import { z } from "zod";
import { createLogger } from "@manga/core";
import { DomainError } from "../domain-error";
import { getBlog, getNewsletter, getSequences } from "../marketing/instance";
import { parseInput, runAdmin, type Result } from "./result";

const idSchema = z.string().min(1).max(64);
const logger = createLogger({ service: "web" });

// ---- back-office (every action starts with `requireAdmin()` through `runAdmin`) -------

export async function listSequencesAction() {
  return runAdmin(() => getSequences().list());
}

export async function getSequenceAction(id: unknown) {
  return runAdmin(() => getSequences().get(parseInput(idSchema, id)));
}

export async function createSequenceAction(name: unknown) {
  return runAdmin((admin) => getSequences().create(parseInput(z.string().max(200), name), admin.userId));
}

export async function updateSequenceAction(id: unknown, input: unknown) {
  return runAdmin((admin) => getSequences().update(parseInput(idSchema, id), parseInput(sequenceInputSchema, input), admin.userId));
}

export async function enrollProspectAction(input: unknown) {
  return runAdmin((admin) => {
    const data = parseInput(z.object({ sequenceId: idSchema, prospectId: idSchema }), input);
    return getSequences().enroll(data.sequenceId, data.prospectId, admin.userId);
  });
}

export async function getMarketingSettingsAction() {
  return runAdmin(() => getSequences().getMarketingSettings());
}

export async function saveMarketingSettingsAction(input: unknown) {
  return runAdmin((admin) => getSequences().saveMarketingSettings(input, admin.userId));
}

export async function listSubscribersAction() {
  return runAdmin(() => getNewsletter().listSubscribers());
}

export async function listBlogPostsAction() {
  return runAdmin(() => getBlog().list());
}

/** Any article, drafts included, for the editor. */
export async function getBlogPostForEditAction(id: unknown) {
  return runAdmin(() => getBlog().get(parseInput(idSchema, id)));
}

export async function saveBlogPostAction(id: unknown, input: unknown) {
  return runAdmin((admin) => {
    const postId = id === null || id === undefined ? undefined : parseInput(idSchema, id);
    return getBlog().save(parseInput(blogPostInputSchema, input), admin.userId, postId);
  });
}

export async function deleteBlogPostAction(id: unknown) {
  return runAdmin(async (admin) => {
    await getBlog().remove(parseInput(idSchema, id), admin.userId);
    return { deleted: true };
  });
}

export async function requestBlogCoverUploadAction(input: unknown) {
  return runAdmin(() => getBlog().requestCoverUpload(parseInput(uploadRequestSchema, input)));
}

// ---- public site: published articles only, no session needed ------------------------

async function runPublic<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, code: error.code, error: error.message };
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "public action failure");
    return { ok: false, code: "INTERNAL", error: "Une erreur est survenue." };
  }
}

export async function listPublishedPostsAction() {
  return runPublic(() => getBlog().listPublished());
}

export async function getPublishedPostAction(idOrSlug: unknown) {
  return runPublic(() => getBlog().getPublished(parseInput(z.string().min(1).max(200), idOrSlug)));
}
