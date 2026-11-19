/**
 * Rôles de la plateforme (avenant n°1, §3). `ADMIN` est Manga Performance ; les trois autres
 * appartiennent à une entreprise cliente.
 */
export const CLIENT_ROLES = ["CLIENT_DIRECTION", "CLIENT_CONTRIBUTEUR", "CLIENT_ANALYSTE"] as const;

export type ClientRole = (typeof CLIENT_ROLES)[number];
export type AppRole = "ADMIN" | ClientRole;

export function isClientRole(role: string | null | undefined): role is ClientRole {
  return (CLIENT_ROLES as readonly string[]).includes(role ?? "");
}

/** Direction et contributeur déposent des fichiers ; l'analyste est en lecture seule (administrateur : en support). */
export function canDeposit(role: AppRole): boolean {
  return role === "ADMIN" || role === "CLIENT_DIRECTION" || role === "CLIENT_CONTRIBUTEUR";
}

/** Direction et analyste voient toutes les entités de leur client ; le contributeur seulement les siennes. */
export function seesWholeClient(role: ClientRole): boolean {
  return role === "CLIENT_DIRECTION" || role === "CLIENT_ANALYSTE";
}
