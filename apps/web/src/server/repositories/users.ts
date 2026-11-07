import { isLocked, onLoginFailure, onLoginSuccess } from "@manga/core";
import type { PrismaClient, Role } from "@manga/db";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  clientId: string | null;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
}

const normalize = (email: string) => email.trim().toLowerCase();

/** User persistence for the auth flows. Prisma never leaves the repositories. */
export function createUsersRepository(prisma: PrismaClient) {
  const toRecord = (
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      clientId: string | null;
      twoFactorEnabled: boolean;
      accounts: { password: string | null }[];
    },
  ): UserRecord => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    twoFactorEnabled: user.twoFactorEnabled,
    hasPassword: user.accounts.some((account) => account.password),
  });

  const include = { accounts: { where: { providerId: "credential" }, select: { password: true } } };

  return {
    async findByEmail(email: string): Promise<UserRecord | null> {
      const user = await prisma.user.findUnique({ where: { email: normalize(email) }, include });
      return user ? toRecord(user) : null;
    },

    async findById(id: string): Promise<UserRecord | null> {
      const user = await prisma.user.findUnique({ where: { id }, include });
      return user ? toRecord(user) : null;
    },

    async create(input: {
      email: string;
      name: string;
      role: Role;
      clientId?: string;
    }): Promise<UserRecord> {
      const user = await prisma.user.create({
        data: {
          email: normalize(input.email),
          name: input.name,
          role: input.role,
          ...(input.clientId ? { clientId: input.clientId } : {}),
        },
        include,
      });
      return toRecord(user);
    },

    /** Sets (or replaces) the credential password and marks the email as verified. */
    async setPassword(userId: string, passwordHash: string): Promise<void> {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.account.findFirst({
          where: { userId, providerId: "credential" },
        });
        if (existing) {
          await tx.account.update({ where: { id: existing.id }, data: { password: passwordHash } });
        } else {
          await tx.account.create({
            data: { userId, accountId: userId, providerId: "credential", password: passwordHash },
          });
        }
        await tx.user.update({
          where: { id: userId },
          data: { emailVerified: true, failedLoginCount: 0, lockedUntil: null },
        });
      });
    },

    async revokeAllSessions(userId: string): Promise<void> {
      await prisma.session.deleteMany({ where: { userId } });
    },

    /** Disables (or re-enables) portal access. Disabling also signs the user out everywhere. */
    async setDisabled(userId: string, disabled: boolean, now: Date = new Date()): Promise<void> {
      await prisma.user.update({
        where: { id: userId },
        data: { disabledAt: disabled ? now : null },
      });
      if (disabled) await prisma.session.deleteMany({ where: { userId } });
    },

    async isDisabled(email: string): Promise<boolean> {
      const user = await prisma.user.findUnique({
        where: { email: normalize(email) },
        select: { disabledAt: true },
      });
      return user?.disabledAt != null;
    },

    async isLockedOut(email: string, now: Date = new Date()): Promise<boolean> {
      const user = await prisma.user.findUnique({
        where: { email: normalize(email) },
        select: { lockedUntil: true },
      });
      return user ? isLocked(user, now) : false;
    },

    async recordLoginFailure(email: string, now: Date = new Date()): Promise<void> {
      const key = { email: normalize(email) };
      const exists = await prisma.user.findUnique({ where: key, select: { id: true } });
      if (!exists) return;
      // Atomic increment first, so concurrent failures are all counted.
      const incremented = await prisma.user.update({
        where: key,
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true, lockedUntil: true },
      });
      const next = onLoginFailure(
        { failedLoginCount: incremented.failedLoginCount - 1, lockedUntil: incremented.lockedUntil },
        now,
      );
      await prisma.user.update({ where: key, data: next });
    },

    async recordLoginSuccess(email: string): Promise<void> {
      await prisma.user.updateMany({ where: { email: normalize(email) }, data: onLoginSuccess() });
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
