import mapping from "../seed/usali-mapping.json" with { type: "json" };

/** Famille USALI : seules les familles départementales et non réparties entrent dans le GOP. */
export type UsaliFamily = "DEPARTEMENTALE" | "NON_REPARTIE" | "HORS_EXPLOITATION";
export type UsaliImpact = "GOP/GOPPAR" | "EBITDA" | "RESULTAT_NET";

export interface UsaliEntry {
  poste: string;
  famille: UsaliFamily;
  sousCategorie: string;
  impact: UsaliImpact;
  commentaire: string;
}

/**
 * Référentiel USALI en lecture seule (avenant §11 ter). Données fictives / indicatives : aucun poste
 * ni montant réel du client n'est conservé dans le dépôt. La source est le JSON de seed, éditable
 * sans toucher au code.
 */
export const usaliMapping: readonly UsaliEntry[] = mapping as readonly UsaliEntry[];
