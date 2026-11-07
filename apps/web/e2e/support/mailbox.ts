import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/** The worker writes every email here instead of sending it (development mailbox). */
export const MAILBOX = resolve(__dirname, "../../../../.dev-mailbox");

export function clearMailbox(): void {
  rmSync(MAILBOX, { recursive: true, force: true });
  mkdirSync(MAILBOX, { recursive: true });
}

/** Waits for an email to `to` whose text contains `needle`, and returns its plain text. */
export async function waitForEmail(to: string, needle: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const name of readdirSync(MAILBOX).filter((n) => n.endsWith(".txt")).sort().reverse()) {
      const text = readFileSync(join(MAILBOX, name), "utf8");
      if (text.startsWith(`To: ${to}\n`) && text.includes(needle)) return text;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} containing "${needle}" within ${timeoutMs} ms`);
}

export function firstUrl(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match) throw new Error(`No link matching ${pattern} in the email`);
  return match[0];
}
