import type { ReferenceView, TestimonialView } from "@/lib/types/references";

/**
 * Démonstration : seule la référence de départ existe, en brouillon. Elle n'est publiée ni ici ni en base tant
 * que le logo et l'autorisation du client ne sont pas fournis (le site public n'affiche donc rien).
 */
export const references: ReferenceView[] = [
  {
    id: "ref-felkat",
    name: "FELKAT",
    sector: "À préciser",
    description: "Description à compléter.",
    displayOrder: 0,
    published: false,
    clientAuthorization: false,
  },
];

export const testimonials: TestimonialView[] = [];
