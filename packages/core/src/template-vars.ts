/** Personalisation variables for email sequences (spec, 6.7). */
export const TEMPLATE_VARIABLES = ["prenom", "entreprise", "secteur", "besoin"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Used when a contact has no value and the template gives no fallback. */
export const VARIABLE_DEFAULTS: Record<TemplateVariable, string> = {
  prenom: "cher client",
  entreprise: "votre entreprise",
  secteur: "votre secteur",
  besoin: "vos besoins",
};

// {{prenom}} or {{prenom|fallback}}
const PATTERN = /\{\{\s*([A-Za-z_]\w*)\s*(?:\|([^{}]*))?\}\}/g;

const isKnown = (name: string): name is TemplateVariable => (TEMPLATE_VARIABLES as readonly string[]).includes(name);

/** Variables used in a text that are not in the allowed list (refused at save time). */
export function unknownVariables(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(PATTERN)) {
    if (!isKnown(match[1]!.toLowerCase())) unknown.add(match[1]!);
  }
  return [...unknown];
}

/** True if braces remain that look like an unfinished variable (`{{ prenom`). */
export function hasMalformedVariable(text: string): boolean {
  return text.replace(PATTERN, "").match(/\{\{|\}\}/) !== null;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Fills the variables. A missing or blank value uses the template's own fallback
 * (`{{prenom|cher client}}`), then the default. With `escape`, values are HTML-escaped so a
 * contact called `<script>` stays text.
 */
export function applyVariables(
  text: string,
  values: Partial<Record<TemplateVariable, string | null | undefined>>,
  options: { escape?: boolean } = {},
): string {
  return text.replace(PATTERN, (_whole, rawName: string, fallback: string | undefined) => {
    const name = rawName.toLowerCase();
    if (!isKnown(name)) return "";
    const value = values[name]?.trim();
    const chosen = value || fallback?.trim() || VARIABLE_DEFAULTS[name];
    return options.escape ? escapeHtml(chosen) : chosen;
  });
}

/** First name from a full contact name ("Awa Koné" -> "Awa"). */
export function firstNameOf(contactName: string | null | undefined): string | undefined {
  const first = contactName?.trim().split(/\s+/)[0];
  return first || undefined;
}

export const NEED_LABELS_FR: Record<string, string> = {
  BUSINESS_PLAN: "votre business plan",
  TABLEAU_DE_BORD: "vos tableaux de bord",
  TRESORERIE: "votre trésorerie",
  MAITRISE_COUTS: "la maîtrise de vos coûts",
  AUDIT: "votre audit",
  AUTRE: "vos besoins",
};
