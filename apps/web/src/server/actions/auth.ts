"use server";

import { headers } from "next/headers";
import {
  acceptInvitationSchema,
  inviteClientSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} from "@manga/validation";
import { getPrisma } from "../db";
import { requireAdmin } from "../auth/guards";
import type { FlowFailure } from "../auth/account-flows";
import { getAccountFlows } from "../auth/flows-instance";
import { LIMITS, RateLimitError, clientIp, consume } from "../auth/rate-limit";
import { recordAudit } from "../repositories/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "La demande n'a pas pu aboutir. Vérifiez les informations saisies.";
const RATE_LIMITED = "Trop de tentatives. Réessayez plus tard.";
const INVALID_LINK = "Ce lien est invalide ou a expiré. Demandez-en un nouveau.";

function messageFor(failure: FlowFailure): string {
  switch (failure.code) {
    case "WEAK_PASSWORD":
      return failure.message;
    case "INVALID_TOKEN":
      return INVALID_LINK;
    case "EMAIL_TAKEN":
      return "Un compte existe déjà avec cet email.";
    case "CLIENT_NOT_FOUND":
      return "Client introuvable.";
    case "ALREADY_ACTIVE":
      return "Ce compte est déjà activé.";
    default:
      return GENERIC_ERROR;
  }
}

async function limit(rule: Parameters<typeof consume>[0], key: string): Promise<boolean> {
  try {
    await consume(rule, key);
    return true;
  } catch (error) {
    if (error instanceof RateLimitError) return false;
    throw error;
  }
}

/** Admin: creates the client's portal account and emails the invitation (72 h link). */
export async function inviteClientAction(input: unknown): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = inviteClientSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_ERROR };

  const result = await getAccountFlows().inviteClientUser(parsed.data);
  if (!result.ok) return { ok: false, error: messageFor(result) };

  await recordAudit(getPrisma(), {
    actorId: admin.userId,
    action: "client.access.invited",
    entity: "User",
    entityId: result.userId,
    diff: { clientId: parsed.data.clientId },
    ip: clientIp(await headers()),
  });
  return { ok: true };
}

/** Public: sets the first password from an invitation link. */
export async function acceptInvitationAction(input: unknown): Promise<ActionResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_LINK };
  if (!(await limit(LIMITS.tokenIp, clientIp(await headers())))) {
    return { ok: false, error: RATE_LIMITED };
  }
  const result = await getAccountFlows().acceptInvitation(parsed.data.token, parsed.data.password);
  return result.ok ? { ok: true } : { ok: false, error: messageFor(result) };
}

/** Public: the answer is identical whether or not the email exists. */
export async function requestPasswordResetAction(input: unknown): Promise<ActionResult> {
  const parsed = requestPasswordResetSchema.safeParse(input);
  if (parsed.success) {
    const ipAllowed = await limit(LIMITS.resetIp, clientIp(await headers()));
    const emailAllowed = ipAllowed && (await limit(LIMITS.resetEmail, parsed.data.email));
    if (ipAllowed && emailAllowed) await getAccountFlows().requestPasswordReset(parsed.data.email);
  }
  return { ok: true };
}

/** Public: sets a new password from a reset link and signs the user out everywhere. */
export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_LINK };
  if (!(await limit(LIMITS.tokenIp, clientIp(await headers())))) {
    return { ok: false, error: RATE_LIMITED };
  }
  const result = await getAccountFlows().resetPassword(parsed.data.token, parsed.data.password);
  return result.ok ? { ok: true } : { ok: false, error: messageFor(result) };
}
