/** Masks an email for logs: `jean.dupont@acme.ci` -> `j***@acme.ci`. */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at < 1) return "***";
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

/** Masks a phone number for logs, keeping the prefix and the last 4 digits. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  const prefix = value.startsWith("+") ? value.slice(0, 4) : "";
  return `${prefix}***${digits.slice(-4)}`;
}

const EMAIL_KEYS = new Set(["email", "contactemail", "to", "from"]);
const PHONE_KEYS = new Set(["phone", "telephone", "tel"]);
const MAX_DEPTH = 5;

/** Returns a copy of `value` where email and phone fields are masked. */
export function maskPii<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => maskPii(item, depth + 1)) as T;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (typeof item === "string" && EMAIL_KEYS.has(lower)) out[key] = maskEmail(item);
    else if (typeof item === "string" && PHONE_KEYS.has(lower)) out[key] = maskPhone(item);
    else out[key] = maskPii(item, depth + 1);
  }
  return out as T;
}
