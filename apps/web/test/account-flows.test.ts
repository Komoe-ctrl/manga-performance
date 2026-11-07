import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccountFlows } from "@/server/auth/account-flows";
import {
  MemoryMailer,
  createClientCompany,
  createUser,
  db,
  login,
  PASSWORD,
  resetDatabase,
  shutdown,
  tokenFromUrl,
  tryLogin,
} from "./helpers";

const HOUR = 3600_000;
let mailer: MemoryMailer;
let clock: Date;
const flows = () =>
  createAccountFlows({
    prisma: db(),
    mailer,
    appUrl: "https://app.example.com",
    now: () => clock,
  });

beforeEach(async () => {
  await resetDatabase();
  mailer = new MemoryMailer();
  clock = new Date();
});
afterAll(shutdown);

describe("client invitation", () => {
  it("creates a pending user and emails a link that expires after 72 hours", async () => {
    const client = await createClientCompany("Acme");
    const result = await flows().inviteClientUser({
      clientId: client.id,
      email: "Contact@Acme.ci",
      name: "Awa Kone",
    });
    expect(result.ok).toBe(true);

    const user = await db().user.findUniqueOrThrow({ where: { email: "contact@acme.ci" } });
    expect(user).toMatchObject({ role: "CLIENT", clientId: client.id, emailVerified: false });
    expect(await db().account.count({ where: { userId: user.id } })).toBe(0);

    const [mail] = mailer.invitations;
    expect(mail!.url.startsWith("https://app.example.com/invitation?token=")).toBe(true);
    expect(mail!.expiresAt.getTime() - clock.getTime()).toBe(72 * HOUR);
  });

  it("stores only a hash of the token", async () => {
    const client = await createClientCompany("Acme");
    await flows().inviteClientUser({ clientId: client.id, email: "a@acme.ci", name: "A" });
    const token = tokenFromUrl(mailer.invitations[0]!.url);
    const rows = await db().verification.findMany();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.identifier).toMatch(/^invite:[0-9a-f]{64}$/);
  });

  it("refuses unknown or deleted clients and already-used emails", async () => {
    expect(
      await flows().inviteClientUser({ clientId: "nope", email: "a@acme.ci", name: "A" }),
    ).toEqual({ ok: false, code: "CLIENT_NOT_FOUND" });

    const gone = await createClientCompany("Gone", new Date());
    expect(
      await flows().inviteClientUser({ clientId: gone.id, email: "a@acme.ci", name: "A" }),
    ).toEqual({ ok: false, code: "CLIENT_NOT_FOUND" });

    const client = await createClientCompany("Acme");
    await createUser({ role: "CLIENT", email: "taken@acme.ci", clientId: client.id });
    expect(
      await flows().inviteClientUser({ clientId: client.id, email: "TAKEN@acme.ci", name: "A" }),
    ).toEqual({ ok: false, code: "EMAIL_TAKEN" });
  });

  it("lets the invitee set a password, once, and then sign in", async () => {
    const client = await createClientCompany("Acme");
    await flows().inviteClientUser({ clientId: client.id, email: "a@acme.ci", name: "A" });
    const token = tokenFromUrl(mailer.invitations[0]!.url);

    expect(await flows().acceptInvitation(token, PASSWORD)).toEqual({ ok: true });
    expect((await tryLogin("a@acme.ci", PASSWORD)).ok).toBe(true);
    expect((await db().user.findUniqueOrThrow({ where: { email: "a@acme.ci" } })).emailVerified).toBe(true);

    // Single use.
    expect(await flows().acceptInvitation(token, "Another-Strong-Pass-1")).toEqual({
      ok: false,
      code: "INVALID_TOKEN",
    });
  });

  it("rejects an expired link", async () => {
    const client = await createClientCompany("Acme");
    await flows().inviteClientUser({ clientId: client.id, email: "a@acme.ci", name: "A" });
    const token = tokenFromUrl(mailer.invitations[0]!.url);
    clock = new Date(clock.getTime() + 73 * HOUR);
    expect(await flows().acceptInvitation(token, PASSWORD)).toEqual({
      ok: false,
      code: "INVALID_TOKEN",
    });
  });

  it("does not burn the link when the password is too weak", async () => {
    const client = await createClientCompany("Acme");
    await flows().inviteClientUser({ clientId: client.id, email: "a@acme.ci", name: "A" });
    const token = tokenFromUrl(mailer.invitations[0]!.url);

    const weak = await flows().acceptInvitation(token, "azertyuiop");
    expect(weak).toMatchObject({ ok: false, code: "WEAK_PASSWORD" });
    expect(await flows().acceptInvitation(token, "short")).toMatchObject({ code: "WEAK_PASSWORD" });
    expect(await flows().acceptInvitation(token, PASSWORD)).toEqual({ ok: true });
  });

  it("only lets one of two concurrent redemptions succeed", async () => {
    const client = await createClientCompany("Acme");
    await flows().inviteClientUser({ clientId: client.id, email: "a@acme.ci", name: "A" });
    const token = tokenFromUrl(mailer.invitations[0]!.url);
    const results = await Promise.all([
      flows().acceptInvitation(token, PASSWORD),
      flows().acceptInvitation(token, "Second-Strong-Pass-2"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("invalidates the previous link when the invitation is resent", async () => {
    const client = await createClientCompany("Acme");
    const created = await flows().inviteClientUser({ clientId: client.id, email: "a@acme.ci", name: "A" });
    if (!created.ok) throw new Error("setup failed");
    await flows().resendInvitation(created.userId);
    const [first, second] = mailer.invitations.map((m) => tokenFromUrl(m.url));
    expect(await flows().acceptInvitation(first!, PASSWORD)).toMatchObject({ code: "INVALID_TOKEN" });
    expect(await flows().acceptInvitation(second!, PASSWORD)).toEqual({ ok: true });
    expect(await flows().resendInvitation(created.userId)).toEqual({ ok: false, code: "ALREADY_ACTIVE" });
  });
});

describe("password reset", () => {
  it("answers identically for known and unknown emails, and only mails known ones", async () => {
    await createUser({ role: "CLIENT", email: "known@acme.ci" });
    await expect(flows().requestPasswordReset("known@acme.ci")).resolves.toBeUndefined();
    await expect(flows().requestPasswordReset("unknown@acme.ci")).resolves.toBeUndefined();
    expect(mailer.resets.map((m) => m.to)).toEqual(["known@acme.ci"]);
  });

  it("does not send a reset to an account that never activated", async () => {
    await createUser({ role: "CLIENT", email: "pending@acme.ci", password: null });
    await flows().requestPasswordReset("pending@acme.ci");
    expect(mailer.resets).toHaveLength(0);
  });

  it("stores the token hashed and expires after one hour", async () => {
    await createUser({ role: "CLIENT", email: "known@acme.ci" });
    await flows().requestPasswordReset("known@acme.ci");
    const token = tokenFromUrl(mailer.resets[0]!.url);
    const rows = await db().verification.findMany();
    expect(JSON.stringify(rows)).not.toContain(token);

    clock = new Date(clock.getTime() + 61 * 60_000);
    expect(await flows().resetPassword(token, "Brand-New-Passphrase-3")).toEqual({
      ok: false,
      code: "INVALID_TOKEN",
    });
  });

  it("sets the password, is single-use, and signs the user out everywhere", async () => {
    const user = await createUser({ role: "CLIENT", email: "known@acme.ci" });
    await login(user.email);
    await login(user.email);
    expect(await db().session.count({ where: { userId: user.id } })).toBe(2);

    await flows().requestPasswordReset("known@acme.ci");
    const token = tokenFromUrl(mailer.resets[0]!.url);
    expect(await flows().resetPassword(token, "Brand-New-Passphrase-3")).toEqual({ ok: true });

    expect(await db().session.count({ where: { userId: user.id } })).toBe(0);
    expect((await tryLogin(user.email, PASSWORD)).ok).toBe(false);
    expect((await tryLogin(user.email, "Brand-New-Passphrase-3")).ok).toBe(true);
    expect(await flows().resetPassword(token, "Yet-Another-Passphrase-4")).toMatchObject({
      code: "INVALID_TOKEN",
    });
  });

  it("clears a lockout, and a new request supersedes the previous link", async () => {
    const user = await createUser({ role: "CLIENT", email: "known@acme.ci" });
    await db().user.update({
      where: { id: user.id },
      data: { failedLoginCount: 3, lockedUntil: new Date(Date.now() + HOUR) },
    });
    await flows().requestPasswordReset("known@acme.ci");
    await flows().requestPasswordReset("known@acme.ci");
    const [first, second] = mailer.resets.map((m) => tokenFromUrl(m.url));
    expect(await flows().resetPassword(first!, "Brand-New-Passphrase-3")).toMatchObject({ code: "INVALID_TOKEN" });
    expect(await flows().resetPassword(second!, "Brand-New-Passphrase-3")).toEqual({ ok: true });
    const row = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it("does not let an invitation token be used as a reset token (or the reverse)", async () => {
    const client = await createClientCompany("Acme");
    await flows().inviteClientUser({ clientId: client.id, email: "a@acme.ci", name: "A" });
    const inviteToken = tokenFromUrl(mailer.invitations[0]!.url);
    expect(await flows().resetPassword(inviteToken, PASSWORD)).toMatchObject({ code: "INVALID_TOKEN" });
  });
});
