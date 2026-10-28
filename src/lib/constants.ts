import type { BlogPost, Need } from "@/lib/types";

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
