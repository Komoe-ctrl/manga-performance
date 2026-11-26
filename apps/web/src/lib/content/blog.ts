import type { BlogPost } from "@/lib/types";
import { excerptFromContent, isProvided, textOfHtml } from "./provided";

/** Un article dont le contenu est encore un texte provisoire n'a rien à montrer au public. */
export const hasRealContent = (post: Pick<BlogPost, "content">): boolean => isProvided(textOfHtml(post.content));

/**
 * Version publiable d'un article : `null` s'il n'a pas de vrai contenu ; sinon, sans extrait réel, l'extrait est généré
 * à partir des 160 premiers caractères du contenu (jamais un extrait provisoire).
 */
export function toPublicPost(post: BlogPost): BlogPost | null {
  if (post.status !== "publie" || !hasRealContent(post)) return null;
  return isProvided(post.excerpt) ? post : { ...post, excerpt: excerptFromContent(post.content) };
}
