import { authClient, fetchCurrentUser } from "@/lib/auth/auth-client";
import * as accountActions from "@/server/actions/auth";
import { getMyCompanyAction } from "@/server/actions/client-space";
import { USE_DB } from "./data-source";

export type AdminSignInResult =
  | { status: "ok" }
  | { status: "two_factor" }
  | { status: "enroll" }
  | { status: "error"; message: string };

const WRONG_CREDENTIALS = "Email ou mot de passe incorrect.";

/** Back-office sign-in. With `DATA_SOURCE=mock` any credentials work, as in the mock-up. */
export async function signInAdmin(email: string, password: string): Promise<AdminSignInResult> {
  if (!USE_DB) return { status: "ok" };

  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    // Lockout and rate-limit messages are already in French and safe to show.
    const specific = error.status === 429 || error.status === 403;
    return { status: "error", message: specific && error.message ? error.message : WRONG_CREDENTIALS };
  }
  if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
    return { status: "two_factor" };
  }

  const user = await fetchCurrentUser();
  if (user?.role !== "ADMIN") {
    await authClient.signOut();
    return { status: "error", message: "Cet espace est réservé au consultant." };
  }
  return user.twoFactorEnabled ? { status: "ok" } : { status: "enroll" };
}

/** Second step of the sign-in: the 6-digit authenticator code. */
export async function verifyTwoFactorCode(code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
  if (error) {
    return {
      ok: false,
      message: error.status === 429 ? "Trop de tentatives. Réessayez dans quelques minutes." : "Code invalide ou expiré.",
    };
  }
  return { ok: true };
}

export interface TwoFactorEnrolment {
  /** Secret for manual entry in an authenticator app (base32). */
  secret: string;
  /** otpauth:// URI, for apps that can open it. */
  uri: string;
  backupCodes: string[];
}

/** Starts 2FA enrolment (the password is asked again). */
export async function startTwoFactorEnrolment(
  password: string,
): Promise<{ ok: true; enrolment: TwoFactorEnrolment } | { ok: false; message: string }> {
  const { data, error } = await authClient.twoFactor.enable({ password });
  if (error || !data) return { ok: false, message: "Mot de passe incorrect." };
  const uri = (data as { totpURI: string }).totpURI;
  return {
    ok: true,
    enrolment: {
      secret: new URL(uri).searchParams.get("secret") ?? "",
      uri,
      backupCodes: (data as { backupCodes: string[] }).backupCodes,
    },
  };
}

export const confirmTwoFactorEnrolment = verifyTwoFactorCode;

export type ClientSignInResult =
  | { status: "ok"; clientId: string }
  | { status: "two_factor" }
  | { status: "error"; message: string };

/** Prospect id of the signed-in client (what the client-space screens use as their client id). */
export async function resolveClientSession(): Promise<{ status: "ok"; clientId: string } | { status: "error"; message: string }> {
  const company = await getMyCompanyAction();
  if (!company.ok) {
    await authClient.signOut();
    return { status: "error", message: "Cet espace est réservé aux clients." };
  }
  return { status: "ok", clientId: company.data.prospectId };
}

/** Client sign-in (db mode). Two-factor is optional for clients: asked only if they enabled it. */
export async function signInClient(email: string, password: string): Promise<ClientSignInResult> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    const specific = error.status === 429 || error.status === 403;
    return { status: "error", message: specific && error.message ? error.message : WRONG_CREDENTIALS };
  }
  if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return { status: "two_factor" };
  return resolveClientSession();
}

export async function signOut(): Promise<void> {
  if (USE_DB) await authClient.signOut();
}

/** Public: sets the first password from an invitation link. */
export async function acceptInvitation(token: string, password: string) {
  return accountActions.acceptInvitationAction({ token, password });
}

/** Public: sets a new password from a reset link. */
export async function resetPassword(token: string, password: string) {
  return accountActions.resetPasswordAction({ token, password });
}

/** Public: always succeeds from the visitor's point of view. */
export async function requestPasswordReset(email: string) {
  return accountActions.requestPasswordResetAction({ email });
}
