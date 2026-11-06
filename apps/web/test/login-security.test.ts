import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth/instance";
import { createUser, db, login, PASSWORD, resetDatabase, shutdown, tryLogin } from "./helpers";

beforeEach(resetDatabase);
afterAll(shutdown);

describe("login", () => {
  it("accepts valid credentials and rejects wrong ones with the same generic error", async () => {
    const user = await createUser({ role: "CLIENT" });
    expect((await tryLogin(user.email, PASSWORD)).ok).toBe(true);
    const wrong = await tryLogin(user.email, "not-the-password");
    const unknown = await tryLogin("nobody@example.com", "not-the-password");
    expect(wrong).toEqual({ ok: false, status: "UNAUTHORIZED" });
    expect(unknown).toEqual(wrong);
  });

  it("locks the account for 15 minutes after 5 failures, even with the right password", async () => {
    const user = await createUser({ role: "CLIENT" });
    for (let i = 0; i < 5; i++) {
      expect((await tryLogin(user.email, "wrong-password-x")).status).toBe("UNAUTHORIZED");
    }
    expect(await tryLogin(user.email, PASSWORD)).toEqual({ ok: false, status: "TOO_MANY_REQUESTS" });

    const locked = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    const minutes = (locked.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    // Lock expires.
    await db().user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await tryLogin(user.email, PASSWORD)).ok).toBe(true);
  });

  it("does not count lock rejections as new failures", async () => {
    const user = await createUser({ role: "CLIENT" });
    for (let i = 0; i < 5; i++) await tryLogin(user.email, "wrong-password-x");
    for (let i = 0; i < 3; i++) await tryLogin(user.email, "wrong-password-x");
    const row = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginCount).toBe(0);
  });

  it("resets the failure counter on success", async () => {
    const user = await createUser({ role: "CLIENT" });
    for (let i = 0; i < 3; i++) await tryLogin(user.email, "wrong-password-x");
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(3);
    await tryLogin(user.email, PASSWORD);
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(0);
  });

  it("rate-limits by IP across different emails", async () => {
    let last: Awaited<ReturnType<typeof tryLogin>> | undefined;
    for (let i = 0; i < 21; i++) last = await tryLogin(`ghost${i}@example.com`, "whatever-pass", "203.0.113.9");
    expect(last).toEqual({ ok: false, status: "TOO_MANY_REQUESTS" });
    // Another IP is unaffected.
    const other = await tryLogin("ghost0@example.com", "whatever-pass", "203.0.113.10");
    expect(other.status).toBe("UNAUTHORIZED");
  });

  it("rate-limits by email across different IPs", async () => {
    let last: Awaited<ReturnType<typeof tryLogin>> | undefined;
    for (let i = 0; i < 11; i++) last = await tryLogin("ghost@example.com", "whatever-pass", `198.51.100.${i}`);
    expect(last).toEqual({ ok: false, status: "TOO_MANY_REQUESTS" });
  });

  it("keeps an unlocked user's sessions intact while another account is locked", async () => {
    const victim = await createUser({ role: "CLIENT" });
    const other = await createUser({ role: "CLIENT" });
    for (let i = 0; i < 5; i++) await tryLogin(victim.email, "wrong-password-x");
    expect((await tryLogin(other.email, PASSWORD)).ok).toBe(true);
  });
});

describe("account creation and passwords", () => {
  it("does not allow public sign-up", async () => {
    await expect(
      getAuth().api.signUpEmail({
        body: { email: "intruder@example.com", password: PASSWORD, name: "Intruder" },
      }),
    ).rejects.toThrow();
    expect(await db().user.count({ where: { email: "intruder@example.com" } })).toBe(0);
  });

  it("rejects weak passwords on change-password", async () => {
    const user = await createUser({ role: "CLIENT" });
    const { cookie } = await login(user.email);
    const attempt = (newPassword: string) =>
      getAuth().api.changePassword({
        body: { currentPassword: PASSWORD, newPassword },
        headers: new Headers({ cookie }),
      });
    await expect(attempt("azertyuiop")).rejects.toThrow();
    await expect(attempt("short")).rejects.toThrow();
    await expect(attempt("A-Brand-New-Passphrase-7")).resolves.toBeTruthy();
  });

  it("stores passwords as argon2id hashes", async () => {
    const user = await createUser({ role: "CLIENT" });
    const account = await db().account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.password).toMatch(/^\$argon2id\$/);
  });

  it("does not expose Better Auth's own password-reset endpoints", async () => {
    const user = await createUser({ role: "CLIENT" });
    await expect(
      getAuth().api.requestPasswordReset({ body: { email: user.email } }),
    ).rejects.toThrow();
  });
});
