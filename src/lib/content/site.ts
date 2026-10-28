import type { Need } from "@/lib/types";

export const TBD = "[À fournir par le client]";

export const contactInfo = {
  address: "Abidjan, Côte d'Ivoire", // TODO: adresse exacte à fournir
  phone: "+225 07 00 00 00 00", // TODO: numéro réel à fournir
  email: "contact@manga-performance.example", // TODO: email réel à fournir
  hours: "Du lundi au vendredi, 8 h – 17 h",
};

export interface ServiceContent {
  slug: string;
  title: string;
  short: string;
  need: Need;
  problem: string;
  approach: string[];
  deliverables: string[];
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
  },
  {
    slug: "tableaux-de-bord-kpi",
    title: "Tableaux de bord KPI",
    short: "Les indicateurs qui comptent, à jour, lisibles en un coup d'œil.",
    need: "tableau_de_bord",
    problem: "Vous décidez avec des chiffres arrivés trop tard, dispersés dans plusieurs fichiers.",
    approach: ["Choix des indicateurs avec la direction", "Consolidation des sources de données", "Mise en forme et formation à l'usage"],
    deliverables: ["Tableau de bord interactif", "Dictionnaire des indicateurs", "Guide d'utilisation"],
  },
  {
    slug: "tresorerie",
    title: "Pilotage de la trésorerie",
    short: "Anticipez vos encaissements et décaissements, évitez les tensions de cash.",
    need: "tresorerie",
    problem: "Votre activité est rentable sur le papier, mais la trésorerie est tendue en fin de mois.",
    approach: ["Diagnostic des flux actuels", "Plan de trésorerie glissant", "Scénarios et plan d'actions"],
    deliverables: ["Plan de trésorerie sur 12 mois (Excel)", "Note de recommandations"],
  },
  {
    slug: "maitrise-des-couts",
    title: "Maîtrise des coûts",
    short: "Identifiez où vos coûts dérapent et reprenez la main.",
    need: "maitrise_couts",
    problem: "Vos coûts vous échappent : écarts avec le budget, marges qui s'érodent sans cause identifiée.",
    approach: ["Analyse des coûts par poste", "Mesure des écarts prévu / réalisé", "Plan de réduction priorisé"],
    deliverables: ["Rapport d'analyse des écarts", "Tableau de suivi budgétaire", "Plan d'actions chiffré"],
  },
];

export const keyFigures = [
  { value: "10+", label: "ans d'expérience" },
  { value: "50+", label: "missions réalisées" }, // placeholder éditable
  { value: "7", label: "secteurs accompagnés" },
  { value: "MBA", label: "Audit & Contrôle de Gestion" },
];

export const references = [
  { sector: "Hôtellerie", context: TBD, mission: TBD, result: TBD },
  { sector: "Santé", context: TBD, mission: TBD, result: TBD },
  { sector: "PME industrie", context: TBD, mission: TBD, result: TBD },
];

export const testimonials = [
  { author: "Directeur général, hôtel à Abidjan", quote: TBD },
  { author: "Gérante, clinique à Bouaké", quote: TBD },
];
