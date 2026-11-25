/**
 * Définition des modèles de collecte (avenant n°1, §4). Un modèle est une donnée : le moteur de
 * contrôle (`engine.ts`) et, plus tard, le générateur Excel lisent la même définition.
 */

export type CollectionSector = "BTP" | "HOTELLERIE" | "RESTAURATION" | "COMMERCE" | "TECH_FINTECH";

export type ColumnKind = "text" | "enum" | "integer" | "decimal" | "amount" | "percent" | "date";

/** Valeur brute d'une cellule, telle que la lecture du fichier la restitue. */
export type RawCell = string | number | boolean | Date | null | undefined;

export type CrossOp = "lt" | "lte" | "gt" | "gte" | "eq";

/** Règle entre colonnes de la même ligne, par exemple `chambresVendues ≤ nombreChambres × jours`. */
export interface CrossRule {
  op: CrossOp;
  /** Colonne de la même ligne ; une liste est additionnée. */
  other: string | readonly string[];
  /** Multiplie l'autre membre par le nombre de jours de la période. */
  times?: "days";
  /** Complément du message, après « supérieur » / « inférieur » : « aux chambres disponibles ». */
  against?: string;
  /** `error` (rejet) par défaut. */
  severity?: "error" | "warning";
}

export interface ColumnDef {
  key: string;
  label: string;
  kind: ColumnKind;
  required?: boolean;
  /** Requis dès que cette autre colonne est renseignée (« revenu sur transactions si TPV »). */
  requiredIf?: string;
  /** Unicité dans le fichier (une seule feuille). */
  uniqueInFile?: boolean;
  /** Unicité à l'intérieur d'un groupe : même valeur de cette autre colonne. */
  uniqueWithin?: string;
  /** Gravité d'un doublon : `error` par défaut. */
  duplicate?: "error" | "warning";
  min?: number;
  max?: number;
  /** Strictement supérieur à (budget > 0). */
  gt?: number;
  /** Les montants sont ≥ 0 sauf mention contraire (trésorerie). */
  allowNegative?: boolean;
  /** Options fixes d'une colonne `enum`. */
  options?: readonly string[];
  /** Options lues dans la configuration du client (catalogue produits…). `by` : colonne dont dépend la liste. */
  optionsFrom?: { name: string; by?: string };
  crossRules?: readonly CrossRule[];
  /** Colonnes de date : doivent tomber dans la période (vrai par défaut). */
  dateInPeriod?: boolean;
  /** Aide affichée dans la feuille `Instructions`. */
  hint?: string;
}

export interface SheetDef {
  name: string;
  label: string;
  /** `single` : une seule ligne de données ; `multiple` : au moins une. */
  rows: "single" | "multiple";
  columns: readonly ColumnDef[];
}

/** Valeurs normalisées d'une ligne (nombres, dates ISO `AAAA-MM-JJ`, textes). */
export type NormalizedValue = string | number | null;
export type NormalizedRow = Record<string, NormalizedValue>;

export interface InputRow {
  /** Numéro de ligne dans le fichier (pour les messages). */
  rowNumber: number;
  cells: Record<string, RawCell>;
}

export type SheetInput = readonly InputRow[];

/** Ligne du référentiel USALI affiché dans la feuille `Instructions` (avenant §11 ter). */
export interface UsaliReferenceRow {
  poste: string;
  famille: "DEPARTEMENTALE" | "NON_REPARTIE" | "HORS_EXPLOITATION";
  sousCategorie: string;
  impact: "GOP/GOPPAR" | "EBITDA" | "RESULTAT_NET";
  commentaire: string;
}

export interface PeriodContext {
  /** Premier jour de la période (UTC). */
  periodStart: Date;
  /** Dernier jour de la période, inclus (UTC). */
  periodEnd: Date;
  /**
   * Configuration du client : listes (`string[]`) ou listes dépendantes d'une autre colonne
   * (`Record<valeur, string[]>`).
   */
  options?: Record<string, readonly string[] | Record<string, readonly string[]>>;
  /** Lignes normalisées du dépôt précédent (mois M-1), par feuille, pour les contrôles de cohérence. */
  previous?: Record<string, readonly NormalizedRow[]>;
}

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  sheet: string;
  /** Ligne du fichier ; `null` pour un problème qui concerne la feuille entière. */
  row: number | null;
  column: string | null;
  columnLabel: string | null;
  /** Valeur trouvée, telle que lue. */
  value: string | null;
  code: string;
  /** Message en français. */
  message: string;
}

/** Contrôle de cohérence propre à un modèle, qui ne produit que des avertissements. */
export type CoherenceCheck = (rows: Record<string, readonly NormalizedRow[]>, ctx: PeriodContext, rowNumbers: Record<string, readonly number[]>) => Issue[];

export interface TemplateDef {
  id: string;
  version: number;
  sector: CollectionSector;
  label: string;
  sheets: readonly SheetDef[];
  coherence?: readonly CoherenceCheck[];
}

export interface ValidationResult {
  /** Vrai s'il n'y a aucune erreur (les avertissements ne bloquent pas). */
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Vrai si le rapport a été tronqué (trop de problèmes). */
  truncated: boolean;
  /** Lignes normalisées par feuille ; en cas de rejet, au mieux (les cellules invalides sont `null`). */
  rows: Record<string, NormalizedRow[]>;
}
