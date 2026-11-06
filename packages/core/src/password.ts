export const PASSWORD_MIN_LENGTH = 10;

/** Most common passwords (English and French), lowercase. Extend freely. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd123",
  "motdepasse", "motdepasse1", "motdepasse12", "motdepasse123", "monmotdepasse",
  "1234567890", "12345678910", "0123456789", "1111111111", "0000000000", "123456789a",
  "azertyuiop", "azerty1234", "azerty12345", "azertyuiop123", "qwertyuiop", "qwerty1234",
  "qwerty12345", "qwertyuiop123", "abcdefghij", "abcd123456", "abc1234567", "iloveyou12",
  "iloveyou123", "welcome123", "welcome1234", "administrator", "admin12345", "admin123456",
  "adminadmin", "letmein123", "changeme123", "changeme12", "trustno1234", "football123",
  "baseball123", "superman123", "master12345", "dragon12345", "monkey12345", "sunshine123",
  "princess123", "bonjour123", "bonjour1234", "bonjour2024", "soleil1234", "doudou1234",
  "chouchou123", "azertyazerty", "passwordpassword", "123456789012", "1234512345",
  "abidjan1234", "abidjan2024", "abidjan2025", "abidjan2026", "cotedivoire", "cotedivoire1",
  "mangaperformance", "mangaperformance1", "manga12345", "manga123456",
]);

export type PasswordIssue = "TOO_SHORT" | "TOO_COMMON" | "CONTAINS_EMAIL";

export interface PasswordCheck {
  ok: boolean;
  issues: PasswordIssue[];
}

/** User-facing messages (French), keyed by issue. */
export const PASSWORD_MESSAGES: Record<PasswordIssue, string> = {
  TOO_SHORT: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
  TOO_COMMON: "Ce mot de passe est trop courant. Choisissez-en un autre.",
  CONTAINS_EMAIL: "Le mot de passe ne doit pas contenir votre adresse email.",
};

/** Password policy: 10 characters minimum, not a common password (spec, section 5). */
export function checkPassword(password: string, email?: string): PasswordCheck {
  const issues: PasswordIssue[] = [];
  if ([...password].length < PASSWORD_MIN_LENGTH) issues.push("TOO_SHORT");

  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) issues.push("TOO_COMMON");

  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && normalized.includes(local)) issues.push("CONTAINS_EMAIL");

  return { ok: issues.length === 0, issues };
}
