/** URL slug: accents transliterated, lowercase, words joined by single dashes (spec, 6.8). */
export function slugify(title: string, maxLength = 80): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "article";
}

/** First free slug: `base`, then `base-2`, `base-3`… `exists` tells whether one is taken. */
export async function uniqueSlug(base: string, exists: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await exists(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 75)}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base.slice(0, 60)}-${Date.now()}`;
}
