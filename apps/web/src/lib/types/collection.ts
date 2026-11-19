/** Module « Collecte & suivi des dépôts » (avenant n°1). Données de démonstration : uniquement fictives. */

export type Sector = "BTP" | "HOTELLERIE" | "RESTAURATION" | "COMMERCE" | "TECH_FINTECH";
export type CollectionFrequency = "MENSUELLE" | "HEBDOMADAIRE";
export type PeriodStatus = "A_VENIR" | "ATTENDU" | "EN_RETARD" | "EN_CONTROLE" | "REJETE" | "VALIDE" | "ACCEPTE_AVEC_RESERVE";

export const SECTOR_LABELS: Record<Sector, string> = {
  BTP: "BTP",
  HOTELLERIE: "Hôtellerie",
  RESTAURATION: "Restauration",
  COMMERCE: "Commerce",
  TECH_FINTECH: "Tech / Fintech",
};

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  A_VENIR: "À venir",
  ATTENDU: "Attendu",
  EN_RETARD: "En retard",
  EN_CONTROLE: "En contrôle",
  REJETE: "Rejeté",
  VALIDE: "Validé",
  ACCEPTE_AVEC_RESERVE: "Accepté avec réserve",
};

export interface CollectionClient {
  id: string;
  name: string;
}

export interface CollectionEntity {
  id: string;
  clientId: string;
  name: string;
  sector: Sector;
}

export interface CollectionTemplateInfo {
  id: string;
  label: string;
  sector: Sector;
}

export interface CollectionPlan {
  id: string;
  entityId: string;
  templateId: string;
  frequency: CollectionFrequency;
  delayDays: number;
  startsOn: string;
  active: boolean;
}

export interface ControlIssue {
  row?: number;
  column?: string;
  value?: string;
  message: string;
}

export interface SubmissionReport {
  errors: ControlIssue[];
  warnings: ControlIssue[];
}

export interface CollectionSubmission {
  id: string;
  version: number;
  originalName: string;
  uploadedBy: string;
  uploadedAt: string;
  status: "EN_CONTROLE" | "REJETE" | "VALIDE" | "ACCEPTE_AVEC_RESERVE";
  report: SubmissionReport | null;
  reviewComment?: string;
}

export interface CollectionReminder {
  at: string;
  kind: "J-2" | "J+1" | "J+3" | "J+5" | "MANUELLE";
  recipients: string;
}

export interface CollectionPeriod {
  id: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  status: PeriodStatus;
  submissions: CollectionSubmission[];
  reminders: CollectionReminder[];
}

/** Ligne du tableau de suivi : un plan de collecte (entité × modèle) et ses périodes. */
export interface TrackingRow {
  plan: CollectionPlan;
  entity: CollectionEntity;
  client: CollectionClient;
  template: CollectionTemplateInfo;
  periods: CollectionPeriod[];
}

export interface CollectionOverview {
  /** Rôle de la session (base de données) : l'écran en déduit ce qu'il montre. Absent en démonstration. */
  viewerRole?: "ADMIN" | "CLIENT_DIRECTION" | "CLIENT_CONTRIBUTEUR" | "CLIENT_ANALYSTE";
  clients: CollectionClient[];
  months: { key: string; label: string }[];
  rows: TrackingRow[];
}
