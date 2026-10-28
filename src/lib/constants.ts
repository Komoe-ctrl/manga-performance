import type { BlogPost, CompanySize, Need, ProspectSource, ProspectStatus } from "@/lib/types";

export const SECTORS = [
  "Hôtellerie",
  "Santé",
  "Restauration",
  "PME industrie",
  "Commerce",
  "BTP",
  "Services",
] as const;

export const CITIES = [
  "Abidjan - Plateau",
  "Abidjan - Cocody",
  "Abidjan - Marcory",
  "Abidjan - Zone 4",
  "Abidjan - Treichville",
  "Abidjan - Yopougon",
  "Bouaké",
  "San-Pédro",
  "Yamoussoukro",
] as const;

export const NEED_LABELS: Record<Need, string> = {
  business_plan: "Business plan",
  tableau_de_bord: "Tableau de bord",
  tresorerie: "Trésorerie",
  maitrise_couts: "Maîtrise des coûts",
  audit: "Audit",
  autre: "Autre",
};

export const CATEGORY_LABELS: Record<BlogPost["category"], string> = {
  controle_de_gestion: "Contrôle de gestion",
  data: "Data",
  audit: "Audit",
};

/** Date de référence de la maquette (les fixtures sont relatives à ce jour). */
export const REFERENCE_DATE = "2026-10-28T09:00:00.000Z";

export const SOURCE_LABELS: Record<ProspectSource, string> = {
  site_formulaire: "Formulaire du site",
  chatbot: "Chatbot",
  scraper: "Scraper",
  newsletter: "Newsletter",
  manuel: "Saisie manuelle",
  recommandation: "Recommandation",
};

export const SIZE_LABELS: Record<CompanySize, string> = {
  tpe: "TPE",
  pme: "PME",
  grande_entreprise: "Grande entreprise",
};

export const STATUS_ORDER: ProspectStatus[] = ["nouveau", "en_negociation", "client", "perdu"];
export const STATUS_LABELS: Record<ProspectStatus, string> = {
  nouveau: "Nouveau",
  en_negociation: "En négociation",
  client: "Client",
  perdu: "Perdu",
};
