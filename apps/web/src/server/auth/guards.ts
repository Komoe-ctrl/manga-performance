import { headers } from "next/headers";
import { isSessionTooOld } from "@manga/core";
import { getPrisma } from "../db";
import { getAuth } from "./instance";

export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "TWO_FACTOR_REQUIRED";

/** Thrown by the guards. Route handlers map it with `authErrorResponse`. */
export class AuthorizationError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthorizationError";
  }
}

export interface AppSession {
  userId: string;
  email: string;
  role: "ADMIN" | "CLIENT";
  clientId: string | null;
  twoFactorEnabled: boolean;
  sessionCreatedAt: Date;
}

export interface AdminSession extends AppSession {
  role: "ADMIN";
}

export interface ClientSession extends AppSession {
  role: "CLIENT";
  clientId: string;
}

async function readSession(): Promise<AppSession | null> {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  const user = result.user as typeof result.user & {
    role?: string;
    clientId?: string | null;
    twoFactorEnabled?: boolean | null;
    disabledAt?: Date | string | null;
  };
  // Access switched off by the firm: refuse even if a session cookie is still around.
  if (user.disabledAt) throw new AuthorizationError("FORBIDDEN");
  return {
    userId: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "CLIENT",
    clientId: user.clientId ?? null,
    twoFactorEnabled: user.twoFactorEnabled === true,
    sessionCreatedAt: new Date(result.session.createdAt),
  };
}

/**
 * Must be called at the start of every admin Server Action and protected Route
 * Handler. The middleware alone is not enough (spec, section 5).
 *
 * Admins must have 2FA enabled; `allowWithoutTwoFactor` exists solely for the
 * enrolment screens themselves.
 */
export async function requireAdmin(
  options: { allowWithoutTwoFactor?: boolean } = {},
): Promise<AdminSession> {
  const session = await readSession();
  if (!session) throw new AuthorizationError("UNAUTHENTICATED");
  if (session.role !== "ADMIN") throw new AuthorizationError("FORBIDDEN");
  if (isSessionTooOld("ADMIN", session.sessionCreatedAt, new Date())) {
    throw new AuthorizationError("SESSION_EXPIRED");
  }
  if (!session.twoFactorEnabled && !options.allowWithoutTwoFactor) {
    throw new AuthorizationError("TWO_FACTOR_REQUIRED");
  }
  return { ...session, role: "ADMIN" };
}

/** Same contract for the client space. The client must exist and not be soft-deleted. */
export async function requireClient(): Promise<ClientSession> {
  const session = await readSession();
  if (!session) throw new AuthorizationError("UNAUTHENTICATED");
  if (session.role !== "CLIENT" || !session.clientId) throw new AuthorizationError("FORBIDDEN");
  if (isSessionTooOld("CLIENT", session.sessionCreatedAt, new Date())) {
    throw new AuthorizationError("SESSION_EXPIRED");
  }
  const client = await getPrisma().client.findFirst({
    where: { id: session.clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new AuthorizationError("FORBIDDEN");
  return { ...session, role: "CLIENT", clientId: session.clientId };
}

/** For downloads shared by both spaces: the admin, or a client (who is then scoped). */
export async function requireAdminOrClient(): Promise<AdminSession | ClientSession> {
  const session = await readSession();
  if (!session) throw new AuthorizationError("UNAUTHENTICATED");
  return session.role === "ADMIN" ? requireAdmin() : requireClient();
}

/**
 * Anti-IDOR: the only way client-space queries get their `clientId`. It always
 * comes from the server-side session, never from the browser.
 *
 *     prisma.invoice.findMany({ where: { ...clientScope(session), status: ... } })
 */
export function clientScope(session: ClientSession): { clientId: string } {
  return { clientId: session.clientId };
}

/** Maps a guard failure to an HTTP response for Route Handlers. */
export function authErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AuthorizationError)) return null;
  const status = error.code === "FORBIDDEN" || error.code === "TWO_FACTOR_REQUIRED" ? 403 : 401;
  return Response.json({ error: error.code }, { status });
}
