import type { Need } from "@/lib/types";

export const TBD = "[À fournir par le client]";

export const contactInfo = {
  address: "Abidjan, Côte d'Ivoire", // TODO: adresse exacte à fournir
  phone: "+225 07 59 56 50 81",
  whatsappNumber: "2250759565081", // format international sans « + », pour wa.me
  email: "diakfode@hotmail.com",
  linkedin: "DIAKITÉ MANGA",
  hours: "Lundi – samedi, 8 h – 18 h (dimanche fermé)",
};

export const DEFAULT_WHATSAPP_MESSAGE = "Bonjour, je souhaite en savoir plus sur vos services.";

// Comptes du cabinet fournis par le client. TODO: ajouter LinkedIn quand le client donnera le lien
// (une icône vers la page d'accueil du réseau n'aide personne : mieux vaut l'omettre).
export const socialLinks = [
  { label: "Facebook", href: "https://www.facebook.com/share/19biV5xEvV/" },
  { label: "Instagram", href: "https://www.instagram.com/lemac70" },
] as const;

export interface ServiceContent {
  slug: string;
  title: string;
  short: string;
  need: Need;
  problem: string;
  approach: string[];
  deliverables: string[];
  /** Description de la page pour les moteurs de recherche : propre à chaque service (≤ 160 caractères). */
  seoDescription: string;
  /** Onglet de la démo qui illustre ce service, quand il en existe un. */
  demo?: { label: string; href: string };
}

export const services: ServiceContent[] = [
  {
    slug: "business-plan-bancable",
    title: "Business plan bancable",
    short: "Un dossier chiffré et crédible pour convaincre banques et investisseurs.",
    need: "business_plan",
    problem: "Votre projet est solide, mais le dossier de financement ne rassure pas les banques : hypothèses floues, prévisions peu argumentées.",
    approach: ["Cadrage du projet et des hypothèses", "Modélisation financière sur 3 à 5 ans", "Relecture avec vous avant dépôt"],
    deliverables: ["Business plan rédigé (PDF)", "Modèle financier (Excel)", "Synthèse pour les financeurs"],
    seoDescription: "Business plan bancable à Abidjan : hypothèses argumentées, modèle financier sur 3 à 5 ans et synthèse pour convaincre banques et investisseurs.",
  },
  {
    slug: "tableaux-de-bord-kpi",
    title: "Tableaux de bord KPI",
    short: "Les indicateurs qui comptent, à jour, lisibles en un coup d'œil.",
    need: "tableau_de_bord",
    problem: "Vous décidez avec des chiffres arrivés trop tard, dispersés dans plusieurs fichiers.",
    approach: ["Choix des indicateurs avec la direction", "Consolidation des sources de données", "Mise en forme et formation à l'usage"],
    deliverables: ["Tableau de bord interactif", "Dictionnaire des indicateurs", "Guide d'utilisation"],
    seoDescription: "Tableaux de bord KPI sur mesure : indicateurs choisis avec la direction, données consolidées, dictionnaire des indicateurs et formation à l'usage.",
    demo: { label: "Voir un exemple de tableau de bord dans la démo", href: "/demo" },
  },
  {
    slug: "tresorerie",
    title: "Pilotage de la trésorerie",
    short: "Anticipez vos encaissements et décaissements, évitez les tensions de cash.",
    need: "tresorerie",
    problem: "Votre activité est rentable sur le papier, mais la trésorerie est tendue en fin de mois.",
    approach: ["Diagnostic des flux actuels", "Plan de trésorerie glissant", "Scénarios et plan d'actions"],
    deliverables: ["Plan de trésorerie sur 12 mois (Excel)", "Note de recommandations"],
    seoDescription: "Pilotage de la trésorerie : diagnostic des flux, plan de trésorerie glissant sur 12 mois, scénarios et plan d'actions pour éviter les tensions de cash.",
  },
  {
    slug: "maitrise-des-couts",
    title: "Maîtrise des coûts",
    short: "Identifiez où vos coûts dérapent et reprenez la main.",
    need: "maitrise_couts",
    problem: "Vos coûts vous échappent : écarts avec le budget, marges qui s'érodent sans cause identifiée.",
    approach: ["Cartographie des coûts et calcul du coût de revient", "Suivi budgétaire : mesure des écarts prévu / réalisé", "Plan de réduction priorisé"],
    deliverables: ["Rapport d'analyse des écarts", "Tableau de suivi budgétaire", "Plan d'actions chiffré"],
    seoDescription: "Maîtrise des coûts : cartographie, coût de revient, suivi budgétaire (budget contre réalisé) et plan de réduction priorisé et chiffré.",
    demo: { label: "Voir le suivi budget contre réalisé dans la démo", href: "/demo" },
  },
];

/** Libellés des chiffres clés ; les valeurs sont éditées dans l'admin (Paramètres → Profil du cabinet). */
export const KEY_FIGURE_LABELS = { experience: "ans d'expérience", missions: "missions réalisées", sectors: "secteurs accompagnés" } as const;
/** Fixe, non éditable. */
export const EXPERTISE_FIGURE = { value: "MBA", label: "Audit & Contrôle de Gestion" };
