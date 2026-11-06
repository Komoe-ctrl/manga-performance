/** A fully rendered message, ready to hand to a provider. */
export interface OutboundEmail {
  /** `Name <address>` or a bare address. */
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<{ messageId: string }>;
}

/** The provider will never accept this message (bad address, bad key): retrying is pointless. */
export class PermanentEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentEmailError";
  }
}

/** Parses `Name <address@host>` (or a bare address). */
export function parseAddress(value: string): { name?: string; email: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+)>\s*$/.exec(value);
  if (match) {
    const name = match[1]?.trim();
    return name ? { name, email: match[2]! } : { email: match[2]! };
  }
  return { email: value.trim() };
}
