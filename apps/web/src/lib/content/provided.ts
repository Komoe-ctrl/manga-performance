/*
 * Contenu « fourni » ou non. Le site public n'affiche jamais un texte provisoire : un élément dont le contenu n'est pas
 * fourni est masqué, et l'admin le montre avec le badge « Contenu manquant ».
 */

/** Marqueur des textes provisoires : « [À fournir par le client] », « [Extrait à fournir…] », « [À compléter] »… */
const PLACEHOLDER = /\[[^\]]*(à fournir|a fournir|à compléter|a completer)[^\]]*\]/i;

export const hasPlaceholder = (text: string | null | undefined): boolean => !!text && PLACEHOLDER.test(text);

/** Vrai si le texte est renseigné et n'est pas un texte provisoire. */
export const isProvided = (text: string | null | undefined): text is string => typeof text === "string" && text.trim().length > 0 && !hasPlaceholder(text);

/** Texte brut d'un contenu HTML (balises retirées), pour mesurer ce qu'il contient vraiment. */
export const textOfHtml = (html: string | null | undefined): string =>
  (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Extrait automatique d'un article : les 160 premiers caractères du contenu, coupés proprement, avec « … » s'il y a une suite. */
export function excerptFromContent(html: string | null | undefined, max = 160): string {
  const text = textOfHtml(html);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
