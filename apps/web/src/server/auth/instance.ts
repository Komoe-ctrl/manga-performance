import { getEnv } from "@manga/core/env";
import { getPrisma } from "../db";
import { createAuth, type Auth } from "./auth";

const globalForAuth = globalThis as unknown as { auth?: Auth };

/** Lazily-created Better Auth singleton (nothing runs at import time, so `next build` stays env-free). */
export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth({ prisma: getPrisma(), env: getEnv() });
  return globalForAuth.auth;
}

/** Test helper. */
export function resetAuth(): void {
  globalForAuth.auth = undefined;
}
