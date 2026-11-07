import { AUTH_POLICY, PASSWORD_MESSAGES, checkPassword } from "@manga/core";
import { createTokenStore, type PrismaClient, type TokenPurpose } from "@manga/db";
import type { AuthMailer } from "../email/auth-mailer";
import { createUsersRepository } from "../repositories/users";
import { hashPassword } from "./password-hash";

export type FlowFailure =
  | { ok: false; code: "CLIENT_NOT_FOUND" | "EMAIL_TAKEN" | "USER_NOT_FOUND" | "ALREADY_ACTIVE" }
  | { ok: false; code: "INVALID_TOKEN" }
  | { ok: false; code: "WEAK_PASSWORD"; message: string };

export interface FlowDeps {
  prisma: PrismaClient;
  mailer: AuthMailer;
  appUrl: string;
  now?: () => Date;
}

/**
 * Account lifecycle: client invitations and password reset (the first admin is created by the seed).
 * Framework-free so it can be tested against a real database without Next.
 */
export function createAccountFlows({ prisma, mailer, appUrl, now = () => new Date() }: FlowDeps) {
  const users = createUsersRepository(prisma);
  const tokens = createTokenStore(prisma);

  const link = (path: string, token: string) =>
    `${appUrl.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;

  async function sendInvitation(user: { id: string; email: string; name: string }) {
    const { token, expiresAt } = await tokens.issue(
      "invite",
      user.id,
      AUTH_POLICY.invitationTtlMs,
      now(),
    );
    await mailer.sendInvitation({
      to: user.email,
      name: user.name,
      url: link("/invitation", token),
      expiresAt,
    });
  }

  /** Checks the password against the policy *before* spending the token. */
  async function setPasswordWithToken(
    purpose: TokenPurpose,
    token: string,
    password: string,
  ): Promise<{ ok: true; userId: string } | FlowFailure> {
    const peekedUserId = await tokens.peek(purpose, token, now());
    const user = peekedUserId ? await users.findById(peekedUserId) : null;
    if (!user) return { ok: false, code: "INVALID_TOKEN" };

    const check = checkPassword(password, user.email);
    if (!check.ok) {
      return { ok: false, code: "WEAK_PASSWORD", message: PASSWORD_MESSAGES[check.issues[0]!] };
    }

    const userId = await tokens.consume(purpose, token, now());
    if (userId !== user.id) return { ok: false, code: "INVALID_TOKEN" };

    await users.setPassword(user.id, await hashPassword(password));
    return { ok: true, userId: user.id };
  }

  return {
    /** Admin action: creates the portal user for a client and emails the invitation. */
    async inviteClientUser(input: {
      clientId: string;
      email: string;
      name: string;
    }): Promise<{ ok: true; userId: string } | FlowFailure> {
      const client = await prisma.client.findFirst({
        where: { id: input.clientId, deletedAt: null },
        select: { id: true },
      });
      if (!client) return { ok: false, code: "CLIENT_NOT_FOUND" };
      if (await users.findByEmail(input.email)) return { ok: false, code: "EMAIL_TAKEN" };

      const user = await users.create({
        email: input.email,
        name: input.name,
        role: "CLIENT",
        clientId: client.id,
      });
      await sendInvitation(user);
      return { ok: true, userId: user.id };
    },

    /** Issues a fresh invitation (the previous link stops working). */
    async resendInvitation(userId: string): Promise<{ ok: true } | FlowFailure> {
      const user = await users.findById(userId);
      if (!user) return { ok: false, code: "USER_NOT_FOUND" };
      if (user.hasPassword) return { ok: false, code: "ALREADY_ACTIVE" };
      await sendInvitation(user);
      return { ok: true };
    },

    async acceptInvitation(token: string, password: string) {
      const result = await setPasswordWithToken("invite", token, password);
      return result.ok ? ({ ok: true } as const) : result;
    },

    /** Always resolves the same way, whether or not the email is known. */
    async requestPasswordReset(email: string): Promise<void> {
      const user = await users.findByEmail(email);
      if (!user || !user.hasPassword) return;
      const { token } = await tokens.issue("reset", user.id, AUTH_POLICY.passwordResetTtlMs, now());
      await mailer.sendPasswordReset({
        to: user.email,
        name: user.name,
        url: link("/reinitialisation", token),
      });
    },

    /** Sets the new password and signs the user out everywhere. */
    async resetPassword(token: string, password: string) {
      const result = await setPasswordWithToken("reset", token, password);
      if (!result.ok) return result;
      await users.revokeAllSessions(result.userId);
      return { ok: true } as const;
    },
  };
}

export type AccountFlows = ReturnType<typeof createAccountFlows>;
