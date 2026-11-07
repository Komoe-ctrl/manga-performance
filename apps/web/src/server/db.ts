import { createPrismaClient, type PrismaClient } from "@manga/db";
import { getEnv } from "@manga/core/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Shared Prisma client. Only repositories and server-side modules may import this. */
export function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient(getEnv().DATABASE_URL);
  return globalForPrisma.prisma;
}
