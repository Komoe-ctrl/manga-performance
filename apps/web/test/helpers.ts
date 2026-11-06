import type { PrismaClient, Role } from "@manga/db";
import type { AuthMailer } from "@/server/email/auth-mailer";
import { getAuth } from "@/server/auth/instance";
import { hashPassword } from "@/server/auth/password-hash";
import { closeRateLimitPool } from "@/server/auth/rate-limit";
import { getPrisma } from "@/server/db";

export const PASSWORD = "Correct-Horse-Battery-9";

/** Headers the mocked `next/headers` returns. Tests set these before calling a guard. */
export const requestState: { headers: Headers } = { headers: new Headers() };

export function db(): PrismaClient {
  return getPrisma();
}

export async function resetDatabase(): Promise<void> {
  await db().$executeRawUnsafe(
    `TRUNCATE TABLE "User", "Session", "Account", "Verification", "TwoFactor", "Client", "Prospect",
      "Invoice", "InvoiceLine", "Deliverable", "DeliverableDownload", "Message", "Notification",
      "AuditLog", rate_limiter CASCADE`,
  );
}

export async function shutdown(): Promise<void> {
  await closeRateLimitPool();
  await db().$disconnect();
}

/** Records every email instead of sending it. */
export class MemoryMailer implements AuthMailer {
  invitations: { to: string; url: string; expiresAt: Date }[] = [];
  resets: { to: string; url: string }[] = [];
  async sendInvitation(input: { to: string; url: string; expiresAt: Date }) {
    this.invitations.push(input);
  }
  async sendPasswordReset(input: { to: string; url: string }) {
    this.resets.push(input);
  }
}

export const tokenFromUrl = (url: string) => new URL(url).searchParams.get("token")!;

export async function createClientCompany(name: string, deletedAt: Date | null = null) {
  const prospect = await db().prospect.create({
    data: {
      companyName: name,
      companyNameNorm: name.toLowerCase(),
      sector: "Commerce",
      source: "MANUEL",
      status: "CLIENT",
    },
  });
  return db().client.create({
    data: { prospectId: prospect.id, legalName: name, deletedAt },
  });
}

let counter = 0;

export async function createUser(options: {
  role: Role;
  email?: string;
  clientId?: string;
  password?: string | null;
  twoFactorEnabled?: boolean;
}) {
  counter += 1;
  const email = options.email ?? `user${counter}@example.com`;
  const user = await db().user.create({
    data: {
      email,
      name: `User ${counter}`,
      role: options.role,
      ...(options.clientId ? { clientId: options.clientId } : {}),
      emailVerified: true,
      twoFactorEnabled: options.twoFactorEnabled ?? false,
    },
  });
  if (options.password !== null) {
    await db().account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword(options.password ?? PASSWORD),
      },
    });
  }
  return user;
}

const ipHeaders = (ip: string) => new Headers({ "x-forwarded-for": ip });

/** Signs in through Better Auth and returns the Cookie header for later requests. */
export async function login(email: string, password = PASSWORD, ip = "10.0.0.1") {
  const { headers, response } = await getAuth().api.signInEmail({
    body: { email, password },
    headers: ipHeaders(ip),
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, response };
}

export async function tryLogin(email: string, password: string, ip = "10.0.0.1") {
  try {
    await getAuth().api.signInEmail({ body: { email, password }, headers: ipHeaders(ip) });
    return { ok: true as const };
  } catch (error) {
    const status = (error as { status?: string }).status;
    return { ok: false as const, status };
  }
}

/** Makes the mocked `next/headers` return this session. */
export function actAs(cookie: string | null) {
  requestState.headers = new Headers(cookie ? { cookie } : {});
}

