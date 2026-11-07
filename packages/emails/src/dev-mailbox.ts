import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EmailProvider, OutboundEmail } from "./provider";

/**
 * Development "inbox": writes each email to a folder instead of sending it. Open the
 * `.html` file in a browser to see the result; the `.txt` is the plain-text alternative.
 */
export class DevMailboxProvider implements EmailProvider {
  readonly name = "dev-mailbox";
  private counter = 0;

  constructor(private readonly directory: string) {}

  async send(email: OutboundEmail): Promise<{ messageId: string }> {
    await mkdir(this.directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${stamp}-${String(++this.counter).padStart(3, "0")}`;
    const header = `<!-- To: ${escapeComment(email.to)} | From: ${escapeComment(email.from)} | Subject: ${escapeComment(email.subject)} -->\n`;
    await writeFile(join(this.directory, `${base}.html`), header + email.html, "utf8");
    await writeFile(
      join(this.directory, `${base}.txt`),
      `To: ${email.to}\nFrom: ${email.from}\nSubject: ${email.subject}\n\n${email.text}\n`,
      "utf8",
    );
    return { messageId: `dev-mailbox:${base}` };
  }
}

const escapeComment = (value: string) => value.replace(/--/g, "- -").replace(/[\r\n]+/g, " ");
