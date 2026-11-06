import { generateToken, hashToken } from "@manga/core";
import type { PrismaClient } from "./generated/client";

export type TokenPurpose = "invite" | "reset";

/**
 * Single-use tokens for invitations and password resets (spec, section 5).
 *
 * Only the SHA-256 of the token is stored (in the Better Auth `Verification`
 * table, identifier `<purpose>:<hash>`); the raw token only exists in the email.
 */
export function createTokenStore(prisma: PrismaClient) {
  const identifierOf = (purpose: TokenPurpose, token: string) =>
    `${purpose}:${hashToken(token)}`;

  return {
    /** Issues a new token for the user, invalidating earlier ones of the same purpose. */
    async issue(
      purpose: TokenPurpose,
      userId: string,
      ttlMs: number,
      now: Date = new Date(),
    ): Promise<{ token: string; expiresAt: Date }> {
      const token = generateToken();
      const expiresAt = new Date(now.getTime() + ttlMs);
      await prisma.$transaction([
        prisma.verification.deleteMany({
          where: { identifier: { startsWith: `${purpose}:` }, value: userId },
        }),
        prisma.verification.create({
          data: { identifier: identifierOf(purpose, token), value: userId, expiresAt },
        }),
      ]);
      return { token, expiresAt };
    },

    /** Reads the user a valid token belongs to, without consuming it. */
    async peek(
      purpose: TokenPurpose,
      token: string,
      now: Date = new Date(),
    ): Promise<string | null> {
      const row = await prisma.verification.findFirst({
        where: { identifier: identifierOf(purpose, token), expiresAt: { gt: now } },
      });
      return row?.value ?? null;
    },

    /** Consumes a token atomically: it can only ever succeed once. */
    async consume(
      purpose: TokenPurpose,
      token: string,
      now: Date = new Date(),
    ): Promise<string | null> {
      const row = await prisma.verification.findFirst({
        where: { identifier: identifierOf(purpose, token) },
      });
      if (!row) return null;
      const { count } = await prisma.verification.deleteMany({
        where: { id: row.id, expiresAt: { gt: now } },
      });
      return count === 1 ? row.value : null;
    },
  };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
