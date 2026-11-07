import { hash, verify } from "@node-rs/argon2";

/** argon2id with the library defaults (m=19 MiB, t=2, p=1 — the OWASP minimum profile). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(input.hash, input.password);
  } catch {
    return false;
  }
}
