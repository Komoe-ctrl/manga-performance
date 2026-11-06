import { createOTP } from "@better-auth/utils/otp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/server/auth/instance";
import { AuthorizationError, requireAdmin } from "@/server/auth/guards";
import { actAs, createUser, db, login, PASSWORD, resetDatabase, shutdown } from "./helpers";

vi.mock("next/headers", async () => {
  const { requestState } = await import("./helpers");
  return { headers: async () => requestState.headers };
});

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The TOTP URI carries the secret base32-encoded; decode it back to the raw string. */
function secretFromUri(uri: string): string {
  const encoded = new URL(uri).searchParams.get("secret")!.replace(/=+$/, "");
  let bits = "";
  for (const char of encoded) bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2));
  return Buffer.from(bytes).toString("utf8");
}

const cookiesOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** Starts TOTP enrolment (password re-check) and narrows the union to the TOTP result. */
async function enrol(cookie: string) {
  const result = await getAuth().api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: new Headers({ cookie }),
  });
  if (result.method !== "totp") throw new Error("expected a TOTP enrolment");
  return result;
}

beforeEach(resetDatabase);
afterAll(shutdown);

describe("admin two-factor authentication", () => {
  it("is mandatory: an admin without 2FA can only reach the enrolment screens", async () => {
    const admin = await createUser({ role: "ADMIN" });
    actAs((await login(admin.email)).cookie);
    await expect(requireAdmin()).rejects.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
    await expect(requireAdmin({ allowWithoutTwoFactor: true })).resolves.toBeTruthy();
  });

  it("enrols with a TOTP code, then requires the code at every sign-in", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { cookie } = await login(admin.email);

    // Enrolment: the password is asked again, the secret is shown once.
    const enrolment = await enrol(cookie);
    expect(enrolment.backupCodes.length).toBeGreaterThan(0);
    const secret = secretFromUri(enrolment.totpURI);
    expect((await db().user.findUniqueOrThrow({ where: { id: admin.id } })).twoFactorEnabled).toBe(false);

    // A wrong code does not activate it.
    await expect(
      getAuth().api.verifyTOTP({ body: { code: "000000" }, headers: new Headers({ cookie }) }),
    ).rejects.toThrow();

    const code = await createOTP(secret).totp();
    const verified = await getAuth().api.verifyTOTP({
      body: { code },
      headers: new Headers({ cookie }),
      returnHeaders: true,
    });
    expect(verified.response.token).toBeTruthy();
    expect((await db().user.findUniqueOrThrow({ where: { id: admin.id } })).twoFactorEnabled).toBe(true);

    // New sign-in: the password alone yields no session, only a 2FA challenge.
    const challenge = await getAuth().api.signInEmail({
      body: { email: admin.email, password: PASSWORD },
      headers: new Headers({ "x-forwarded-for": "10.9.9.9" }),
      returnHeaders: true,
    });
    expect(challenge.response).toMatchObject({ twoFactorRedirect: true });
    const challengeCookie = cookiesOf(challenge.headers);
    // The session cookie is cleared (empty value), not set.
    expect(challengeCookie).not.toMatch(/session_token=[^;\s]/);

    actAs(challengeCookie);
    await expect(requireAdmin()).rejects.toBeInstanceOf(AuthorizationError);

    // Completing the challenge opens the session.
    const done = await getAuth().api.verifyTOTP({
      body: { code: await createOTP(secret).totp() },
      headers: new Headers({ cookie: challengeCookie }),
      returnHeaders: true,
    });
    actAs(cookiesOf(done.headers));
    await expect(requireAdmin()).resolves.toMatchObject({ userId: admin.id, twoFactorEnabled: true });
  });

  it("rejects a wrong code during sign-in", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { cookie } = await login(admin.email);
    const enrolment = await enrol(cookie);
    await getAuth().api.verifyTOTP({
      body: { code: await createOTP(secretFromUri(enrolment.totpURI)).totp() },
      headers: new Headers({ cookie }),
    });

    const challenge = await getAuth().api.signInEmail({
      body: { email: admin.email, password: PASSWORD },
      headers: new Headers({ "x-forwarded-for": "10.9.9.8" }),
      returnHeaders: true,
    });
    await expect(
      getAuth().api.verifyTOTP({
        body: { code: "123456" },
        headers: new Headers({ cookie: cookiesOf(challenge.headers) }),
      }),
    ).rejects.toThrow();
  });
});
