import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { AUTH_POLICY, PASSWORD_MESSAGES, checkPassword, type Env } from "@manga/core";
import type { PrismaClient } from "@manga/db";
import { createUsersRepository } from "../repositories/users";
import { hashPassword, verifyPassword } from "./password-hash";
import { LIMITS, RateLimitError, clientIp, consume } from "./rate-limit";

const SIGN_IN_PATH = "/sign-in/email";
const PASSWORD_PATHS = new Set(["/change-password", "/set-password"]);

function tooManyRequests(error: RateLimitError): APIError {
  return new APIError("TOO_MANY_REQUESTS", {
    message: `Trop de tentatives. Réessayez dans ${Math.ceil(error.retryAfterSeconds / 60)} min.`,
  });
}

export interface AuthDeps {
  prisma: PrismaClient;
  env: Pick<Env, "APP_URL" | "BETTER_AUTH_SECRET">;
}

/**
 * Better Auth instance (spec, section 5).
 *
 * - Accounts are never self-service: sign-up is disabled, clients are invited.
 * - Invitations and password resets use our own hashed single-use tokens
 *   (see `@manga/db` token store), not Better Auth's, to get 72 h / 1 h lifetimes
 *   and hashed storage.
 * - Brute force: per-IP and per-email rate limits, then a 15 min lock after 5 failures.
 */
export function createAuth({ prisma, env }: AuthDeps) {
  const users = createUsersRepository(prisma);

  return betterAuth({
    appName: "Manga Performance",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: prismaAdapter(prisma, { provider: "postgresql" }),

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      password: { hash: hashPassword, verify: verifyPassword },
    },

    session: {
      // Sliding expiry. The 12 h admin cap is enforced by `requireAdmin` (absolute age).
      expiresIn: AUTH_POLICY.clientSessionMaxAgeMs / 1000,
      updateAge: 60 * 60,
    },

    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "CLIENT", input: false },
        clientId: { type: "string", required: false, input: false },
        disabledAt: { type: "date", required: false, input: false },
      },
    },

    advanced: {
      // Explicit rather than inferred: session cookies are `Secure` in production.
      useSecureCookies: process.env.NODE_ENV === "production",
      // Ids come from Prisma (`@default(cuid(2))`), as for every other table.
      database: { generateId: false },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },

    plugins: [twoFactor({ issuer: "Manga Performance" }), nextCookies()],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const ip = clientIp(ctx.headers);
        try {
          if (ctx.path === SIGN_IN_PATH) {
            const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "")
              .trim()
              .toLowerCase();
            await consume(LIMITS.loginIp, ip);
            if (email) await consume(LIMITS.loginEmail, email);
            if (email && (await users.isDisabled(email))) {
              throw new APIError("FORBIDDEN", {
                message: "Accès désactivé. Contactez votre consultant.",
              });
            }
            if (email && (await users.isLockedOut(email))) {
              throw new APIError("TOO_MANY_REQUESTS", {
                message: "Compte temporairement verrouillé. Réessayez dans 15 minutes.",
              });
            }
          } else if (ctx.path.startsWith("/two-factor/")) {
            await consume(LIMITS.twoFactorIp, ip);
          }
        } catch (error) {
          if (error instanceof RateLimitError) throw tooManyRequests(error);
          throw error;
        }

        if (PASSWORD_PATHS.has(ctx.path)) {
          const body = ctx.body as { newPassword?: unknown } | undefined;
          const candidate = typeof body?.newPassword === "string" ? body.newPassword : "";
          const check = checkPassword(candidate);
          if (!check.ok) {
            throw new APIError("BAD_REQUEST", { message: PASSWORD_MESSAGES[check.issues[0]!] });
          }
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "")
          .trim()
          .toLowerCase();
        if (!email) return;
        if (ctx.context.returned instanceof APIError) {
          // Rate-limit and lock rejections come from the before hook: do not count them.
          if (ctx.context.returned.status !== "TOO_MANY_REQUESTS") {
            await users.recordLoginFailure(email);
          }
        } else {
          await users.recordLoginSuccess(email);
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
