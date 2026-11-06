export type ProspectStatus = "nouveau" | "en_negociation" | "client" | "perdu";
export type ProspectSource =
  | "site_formulaire"
  | "chatbot"
  | "scraper"
  | "newsletter"
  | "manuel"
  | "recommandation";
export type CompanySize = "tpe" | "pme" | "grande_entreprise";
export type Need =
  | "business_plan"
  | "tableau_de_bord"
  | "tresorerie"
  | "maitrise_couts"
  | "audit"
  | "autre";

export interface Prospect {
  id: string;
  companyName: string;
  contactName: string;
  email?: string;
  phone?: string;
  sector: string;
  city: string;
  size: CompanySize;
  need: Need;
  status: ProspectStatus;
  source: ProspectSource;
  estimatedValue?: number; // FCFA, pour le CA prévisionnel
  ownerNote?: string;
  createdAt: string;
  nextFollowUpAt?: string; // prochaine relance
}

export type InteractionType = "email" | "appel" | "reunion" | "note";
export interface Interaction {
  id: string;
  prospectId: string;
  type: InteractionType;
  summary: string;
  date: string;
}

export interface FollowUp {
  id: string;
  prospectId: string;
  dueAt: string;
  rule: "J+7" | "J+15" | "J+30" | "manuel";
  done: boolean;
}

export type InvoiceStatus =
  | "brouillon"
  | "emise"
  | "payee"
  | "en_attente"
  | "en_retard"
  | "annulee";
export interface InvoiceLine {
  label: string;
  quantity: number;
  unitPrice: number;
}
export interface Invoice {
  id: string;
  number: string; // format 2026-001
  fneNumber?: string; // numéro de Facture Normalisée Électronique (DGI)
  clientId: string;
  lines: InvoiceLine[];
  vatRate: number; // 0.18 par défaut
  issuedAt: string;
  dueAt: string;
  status: InvoiceStatus;
  remindersSent: number;
}

export interface EmailSequence {
  id: string;
  name: string;
  trigger: "inscription_newsletter" | "manuel";
  steps: { order: number; delayDays: number; subject: string; body: string }[];
  active: boolean;
  stats: {
    enrolled: number;
    sent: number;
    opened: number;
    clicked: number;
    unsubscribed: number;
  };
}

export interface ScrapeJob {
  id: string;
  source: "annuaire" | "appels_offres" | "site_web";
  filters: { sector?: string; city?: string; size?: CompanySize };
  status: "en_cours" | "termine" | "echec";
  startedAt: string;
  resultsCount: number;
}
export interface ScrapeResult {
  id: string;
  jobId: string;
  companyName: string;
  sector: string;
  address?: string;
  phone?: string;
  email?: string;
  importedToCrm: boolean;
  duplicateOf?: string;
}

export interface Deliverable {
  id: string;
  clientId: string;
  title: string;
  fileType: "pdf" | "xlsx";
  sizeKb: number;
  publishedAt: string;
  isNew: boolean;
}
export interface Message {
  id: string;
  clientId: string;
  from: "consultant" | "client";
  body: string;
  sentAt: string;
  read: boolean;
  attachment?: string; // nom du fichier joint (simulé)
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: "controle_de_gestion" | "data" | "audit";
  content: string;
  coverImage?: string;
  status: "brouillon" | "publie";
  publishedAt?: string;
  seo: { metaTitle?: string; metaDescription?: string };
}

export interface NewsletterSubscriber {
  id: string;
  email: string;
  confirmed: boolean; // double opt-in
  subscribedAt: string;
  unsubscribedAt?: string;
}

/** Client = prospect au statut « client » + accès à l'espace client. */
export interface ClientAccess {
  clientId: string; // = Prospect.id
  active: boolean;
}

export type Session =
  | { role: "consultant" }
  | { role: "client"; clientId: string }
  | null;
