/** Fails fast at server start when the environment is incomplete (spec, section 11). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { getEnv } = await import("@manga/core/env");
  getEnv();
}
