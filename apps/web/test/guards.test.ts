import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationError,
  authErrorResponse,
  clientScope,
  requireAdmin,
  requireClient,
} from "@/server/auth/guards";
import {
  actAs,
  createClientCompany,
  createUser,
  db,
  login,
  resetDatabase,
  shutdown,
} from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "OK";
  } catch (error) {
    if (error instanceof AuthorizationError) return error.code;
    throw error;
  }
};

beforeEach(async () => {
  await resetDatabase();
  actAs(null);
});
afterAll(shutdown);

describe("requireAdmin", () => {
  it("rejects anonymous visitors", async () => {
    expect(await codeOf(requireAdmin())).toBe("UNAUTHENTICATED");
  });

  it("rejects a client session", async () => {
    const client = await createClientCompany("Acme");
    const user = await createUser({ role: "CLIENT", clientId: client.id });
    actAs((await login(user.email)).cookie);
    expect(await codeOf(requireAdmin())).toBe("FORBIDDEN");
  });

  it("requires 2FA, except on the enrolment screens", async () => {
    const admin = await createUser({ role: "ADMIN" });
    actAs((await login(admin.email)).cookie);
    expect(await codeOf(requireAdmin())).toBe("TWO_FACTOR_REQUIRED");
    expect(await codeOf(requireAdmin({ allowWithoutTwoFactor: true }))).toBe("OK");
  });

  it("accepts an admin with 2FA enabled", async () => {
    const admin = await createUser({ role: "ADMIN", twoFactorEnabled: false });
    const { cookie } = await login(admin.email);
    await db().user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
    actAs(cookie);
    const session = await requireAdmin();
    expect(session).toMatchObject({ userId: admin.id, role: "ADMIN", twoFactorEnabled: true });
  });

  it("expires admin sessions after 12 hours even if the cookie is still valid", async () => {
    const admin = await createUser({ role: "ADMIN", twoFactorEnabled: true });
    // With 2FA enabled the password step alone gives no session: create one directly.
    await db().user.update({ where: { id: admin.id }, data: { twoFactorEnabled: false } });
    const { cookie } = await login(admin.email);
    await db().user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
    await db().session.updateMany({
      where: { userId: admin.id },
      data: { createdAt: new Date(Date.now() - 13 * 3600_000) },
    });
    actAs(cookie);
    expect(await codeOf(requireAdmin())).toBe("SESSION_EXPIRED");
  });

  it("rejects a forged or revoked session cookie", async () => {
    const admin = await createUser({ role: "ADMIN", twoFactorEnabled: false });
    const { cookie } = await login(admin.email);
    await db().session.deleteMany({ where: { userId: admin.id } });
    actAs(cookie);
    expect(await codeOf(requireAdmin({ allowWithoutTwoFactor: true }))).toBe("UNAUTHENTICATED");
    actAs("better-auth.session_token=forged.value");
    expect(await codeOf(requireAdmin({ allowWithoutTwoFactor: true }))).toBe("UNAUTHENTICATED");
  });
});

describe("requireClient", () => {
  it("rejects anonymous visitors and admins", async () => {
    expect(await codeOf(requireClient())).toBe("UNAUTHENTICATED");
    const admin = await createUser({ role: "ADMIN" });
    actAs((await login(admin.email)).cookie);
    expect(await codeOf(requireClient())).toBe("FORBIDDEN");
  });

  it("accepts a client and exposes the server-side client id", async () => {
    const client = await createClientCompany("Acme");
    const user = await createUser({ role: "CLIENT", clientId: client.id });
    actAs((await login(user.email)).cookie);
    const session = await requireClient();
    expect(session.clientId).toBe(client.id);
    expect(clientScope(session)).toEqual({ clientId: client.id });
  });

  it("rejects a client user whose company was soft-deleted", async () => {
    const client = await createClientCompany("Gone", new Date());
    const user = await createUser({ role: "CLIENT", clientId: client.id });
    actAs((await login(user.email)).cookie);
    expect(await codeOf(requireClient())).toBe("FORBIDDEN");
  });

  it("rejects a client user not attached to any company", async () => {
    const user = await createUser({ role: "CLIENT" });
    actAs((await login(user.email)).cookie);
    expect(await codeOf(requireClient())).toBe("FORBIDDEN");
  });
});

describe("authErrorResponse", () => {
  it("maps guard failures to HTTP statuses", async () => {
    expect(authErrorResponse(new AuthorizationError("UNAUTHENTICATED"))?.status).toBe(401);
    expect(authErrorResponse(new AuthorizationError("SESSION_EXPIRED"))?.status).toBe(401);
    expect(authErrorResponse(new AuthorizationError("FORBIDDEN"))?.status).toBe(403);
    expect(authErrorResponse(new AuthorizationError("TWO_FACTOR_REQUIRED"))?.status).toBe(403);
    expect(authErrorResponse(new Error("boom"))).toBeNull();
  });
});
