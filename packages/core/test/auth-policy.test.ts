import { describe, expect, it } from "vitest";
import {
  AUTH_POLICY,
  type LockState,
  isLocked,
  isSessionTooOld,
  onLoginFailure,
  onLoginSuccess,
} from "../src/auth-policy";

const now = new Date("2026-11-06T10:00:00Z");
const fresh: LockState = { failedLoginCount: 0, lockedUntil: null };

describe("login lockout", () => {
  it("counts failures without locking before the 5th", () => {
    let state = fresh;
    for (let i = 1; i <= 4; i++) {
      state = onLoginFailure(state, now);
      expect(state).toEqual({ failedLoginCount: i, lockedUntil: null });
      expect(isLocked(state, now)).toBe(false);
    }
  });
  it("locks for 15 minutes at the 5th failure", () => {
    const state = onLoginFailure({ failedLoginCount: 4, lockedUntil: null }, now);
    expect(state.lockedUntil).toEqual(new Date("2026-11-06T10:15:00Z"));
    expect(isLocked(state, now)).toBe(true);
    expect(isLocked(state, new Date("2026-11-06T10:15:01Z"))).toBe(false);
  });
  it("starts a new series after an expired lock", () => {
    const later = new Date("2026-11-06T11:00:00Z");
    const state = onLoginFailure(
      { failedLoginCount: 0, lockedUntil: new Date("2026-11-06T10:15:00Z") },
      later,
    );
    expect(state).toEqual({ failedLoginCount: 1, lockedUntil: null });
  });
  it("resets on success", () => {
    expect(onLoginSuccess()).toEqual(fresh);
  });
});

describe("isSessionTooOld", () => {
  const hours = (h: number) => new Date(now.getTime() - h * 3600_000);
  it("caps admin sessions at 12 hours", () => {
    expect(isSessionTooOld("ADMIN", hours(11), now)).toBe(false);
    expect(isSessionTooOld("ADMIN", hours(13), now)).toBe(true);
  });
  it("caps client sessions at 7 days", () => {
    expect(isSessionTooOld("CLIENT", hours(24 * 6), now)).toBe(false);
    expect(isSessionTooOld("CLIENT", hours(24 * 8), now)).toBe(true);
  });
  it("exposes the 72h invitation and 1h reset lifetimes", () => {
    expect(AUTH_POLICY.invitationTtlMs).toBe(72 * 3600_000);
    expect(AUTH_POLICY.passwordResetTtlMs).toBe(3600_000);
  });
});
