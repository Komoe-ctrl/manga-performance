import { createLogger } from "@manga/core";
import { AuthorizationError, requireAdmin, type AdminSession } from "../auth/guards";
import type { z } from "zod";
import { CrmError } from "../crm/errors";

/**
 * Server Actions must not throw to the browser: in production Next.js replaces the
 * message with a generic one. Every action therefore returns a `Result`, and the
 * front services (`lib/services`) turn failures back into exceptions.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

/** Validates untrusted input inside `runAdmin`; failures become an `INVALID` result. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CrmError("INVALID", "Les données saisies sont invalides.");
  return parsed.data;
}

const logger = createLogger({ service: "web" });

const AUTH_MESSAGES: Record<AuthorizationError["code"], string> = {
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  SESSION_EXPIRED: "Session expirée. Reconnectez-vous.",
  FORBIDDEN: "Accès refusé.",
  TWO_FACTOR_REQUIRED: "Activez la double authentification pour continuer.",
};

/** Runs an admin-only operation: authorization first, then business errors mapped to a `Result`. */
export async function runAdmin<T>(operation: (admin: AdminSession) => Promise<T>): Promise<Result<T>> {
  try {
    const admin = await requireAdmin();
    return { ok: true, data: await operation(admin) };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, code: error.code, error: AUTH_MESSAGES[error.code] };
    }
    if (error instanceof CrmError) {
      return { ok: false, code: error.code, error: error.message };
    }
    // Never log the error object itself: database errors can embed submitted values.
    logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "unexpected action failure");
    return { ok: false, code: "INTERNAL", error: "Une erreur est survenue. Réessayez." };
  }
}
