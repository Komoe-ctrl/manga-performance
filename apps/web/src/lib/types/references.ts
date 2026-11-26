/** Références clients et témoignages du site public (gérés dans /admin/references). */

export interface ReferenceView {
  id: string;
  name: string;
  sector: string;
  description: string;
  logoUrl?: string;
  url?: string;
  displayOrder: number;
  published: boolean;
  /** Le client autorise la citation de son nom et de son logo : obligatoire pour publier. */
  clientAuthorization: boolean;
}

export interface TestimonialView {
  id: string;
  quote: string;
  author: string;
  authorRole: string;
  referenceId: string;
  company: string;
  published: boolean;
  /** Autorisation écrite de l'auteur : obligatoire pour publier. */
  writtenAuthorization: boolean;
}

/** Ce que le site public reçoit : ni brouillon, ni indicateur d'autorisation, rien d'interne. */
export type PublicReference = Pick<ReferenceView, "id" | "name" | "sector" | "description" | "logoUrl" | "url">;
export type PublicTestimonial = Pick<TestimonialView, "id" | "quote" | "author" | "authorRole" | "company">;
