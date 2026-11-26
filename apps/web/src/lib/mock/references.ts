import type { ReferenceView, TestimonialView } from "@/lib/types/references";

/**
 * Démonstration : seule la référence de départ existe, en brouillon. Elle n'est publiée ni ici ni en base tant
 * que le logo et l'autorisation du client ne sont pas fournis (le site public n'affiche donc rien). Aucun numéro de téléphone.
 */
export const references: ReferenceView[] = [
  {
    id: "ref-felkat",
    name: "FELKAT",
    sector: "Tech / SaaS — Intelligence artificielle conversationnelle",
    description:
      "FELKAT développe des agents vocaux IA qui automatisent les appels des entreprises : réponse aux clients, qualification des prospects et campagnes d'appels, avec une expérience naturelle et disponible 24 h/24.",
    displayOrder: 0,
    published: false,
    clientAuthorization: false,
  },
];

export const testimonials: TestimonialView[] = [];
