/** Minimum trigram similarity for two company names to be considered the same (spec, 6.1). */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

/** Trigrams as PostgreSQL's pg_trgm computes them: words padded with 2 spaces before, 1 after. */
function trigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (const word of value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) result.add(padded.slice(i, i + 3));
  }
  return result;
}

/**
 * Same measure as `similarity()` from pg_trgm (shared trigrams / all distinct trigrams),
 * so in-memory checks (e.g. duplicates inside one scrape job) agree with database ones.
 */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared++;
  return shared / (left.size + right.size - shared);
}

export interface DuplicateKeys {
  email?: string | null;
  phone?: string | null;
  companyNameNorm: string;
}

export type DuplicateReason = "EMAIL" | "PHONE" | "NAME";

/** Compares two contacts: same email, same phone, or similar company name (in that order). */
export function findDuplicateReason(a: DuplicateKeys, b: DuplicateKeys): DuplicateReason | null {
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) return "EMAIL";
  if (a.phone && b.phone && a.phone === b.phone) return "PHONE";
  if (trigramSimilarity(a.companyNameNorm, b.companyNameNorm) > DUPLICATE_SIMILARITY_THRESHOLD) {
    return "NAME";
  }
  return null;
}
