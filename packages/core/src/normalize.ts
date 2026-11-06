/** Contact normalisation (spec, section 3). Used before storing and before deduplicating. */

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalises an Ivorian phone number to E.164 (`+225XXXXXXXXXX`).
 * Accepts local numbers (10 digits), `+225`/`00225`/`225` prefixes, spaces, dots, dashes
 * and parentheses. Returns `null` for anything that is not a plausible Ivorian number.
 */
export function normalizePhone(value: string): string | null {
  let digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith("225")) digits = digits.slice(3);
  // Ivorian numbers have had 10 digits since 2021.
  if (!/^\d{10}$/.test(digits)) return null;
  return `+225${digits}`;
}

const LEGAL_FORMS = new Set([
  "sarl", "sa", "sas", "sasu", "eurl", "snc", "scs", "gie", "ets", "etablissements", "etablissement", "cie", "ltd", "llc", "inc",
]);

/**
 * Company name for deduplication: lowercase, no accents, no legal form
 * ("SARL", "SA", "SAS"…), no punctuation, single spaces.
 */
export function normalizeCompanyName(value: string): string {
  const ascii = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Dotted acronyms: "s.a.r.l." -> "sarl".
    .replace(/\b(?:[a-z]\.){2,}[a-z]?/g, (acronym) => acronym.replace(/\./g, ""))
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ascii
    .split(" ")
    .filter((word) => word && !LEGAL_FORMS.has(word))
    .join(" ");
}
