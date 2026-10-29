/** Contenus fournis par le client (fiche de présentation du consultant). */

export const consultant = {
  name: "Diakité Manga",
  role: "Consultant indépendant",
  photo: "/images/consultant.jpg",
  photoAlt: "Portrait de Diakité Manga, consultant en audit, data analytique et contrôle de gestion",
  bio: "Consultant indépendant en Audit, Data Analytique et Contrôle de Gestion, j'accompagne les dirigeants dans la maîtrise des coûts, le pilotage de la trésorerie et la prise de décision basée sur les données.",
  quote: "La performance n'est pas un accident : elle résulte d'une gouvernance rigoureuse et de données fiables.",
};

export const tagline = "Optimisez vos coûts, pilotez votre performance !";

export const problems = [
  "Coûts non maîtrisés",
  "Pas de budget prévisionnel",
  "Trésorerie tendue",
  "Aucun tableau de bord",
  "Décisions intuitives",
];

export const keyMissions = [
  { title: "Cartographie des coûts", text: "Analyse des dépenses et calcul du coût de revient" },
  { title: "Suivi budgétaire", text: "Planification et suivi des écarts" },
  { title: "Pilotage de la trésorerie", text: "Gestion du cash et anticipation des besoins" },
  { title: "Tableaux de bord KPI", text: "Indicateurs de performance stratégique" },
];

export const sectors = ["PME & Startups", "Hôtels", "Restaurants & Bars", "Cliniques & Centres médicaux"];

/** Formules d'accompagnement. Aucun prix affiché : devis sur mesure. */
export const formulas = [
  { name: "Diagnostic Express", duration: "5 jours", detail: "Audit flash + tableau de bord simplifié" },
  { name: "Pilotage Complet", duration: "3 mois", detail: "Suivi mensuel + accompagnement", featured: true },
  { name: "Abonnement Mensuel", duration: "12 mois", detail: "Reporting & alertes automatiques" },
];
