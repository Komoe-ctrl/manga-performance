/** Authentication policy constants (spec, section 5). */
export const AUTH_POLICY = {
  /** Admin sessions are capped at 12 hours, whatever the sliding expiry. */
  adminSessionMaxAgeMs: 12 * 60 * 60 * 1000,
  /** Client sessions slide up to 7 days. */
  clientSessionMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxFailedLogins: 5,
  lockoutDurationMs: 15 * 60 * 1000,
  invitationTtlMs: 72 * 60 * 60 * 1000,
  passwordResetTtlMs: 60 * 60 * 1000,
} as const;

export interface LockState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export function isLocked(state: Pick<LockState, "lockedUntil">, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/** State after a failed login: locks for 15 minutes at the 5th consecutive failure. */
export function onLoginFailure(state: LockState, now: Date): LockState {
  // A lock that already expired starts a fresh series of attempts.
  const base = state.lockedUntil && !isLocked(state, now) ? 0 : state.failedLoginCount;
  const failedLoginCount = base + 1;
  if (failedLoginCount >= AUTH_POLICY.maxFailedLogins) {
    return { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + AUTH_POLICY.lockoutDurationMs) };
  }
  return { failedLoginCount, lockedUntil: null };
}

export function onLoginSuccess(): LockState {
  return { failedLoginCount: 0, lockedUntil: null };
}

/** True when a session is older than the absolute cap for its role. */
export function isSessionTooOld(role: "ADMIN" | "CLIENT", createdAt: Date, now: Date): boolean {
  const max =
    role === "ADMIN" ? AUTH_POLICY.adminSessionMaxAgeMs : AUTH_POLICY.clientSessionMaxAgeMs;
  return now.getTime() - createdAt.getTime() > max;
}
