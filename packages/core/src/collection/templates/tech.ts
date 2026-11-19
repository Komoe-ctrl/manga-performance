import type { SheetDef, TemplateDef } from "../types";

/** Données brutes, jamais des indicateurs déjà calculés (avenant §4.5). */
const SAISIE: SheetDef = {
  name: "Saisie_Tech",
  label: "Produits et segments",
  rows: "multiple",
  columns: [
    { key: "segment", label: "Produit / segment", kind: "text", required: true, uniqueInFile: true },
    { key: "mrrDebut", label: "MRR début de mois (FCFA)", kind: "amount", required: true },
    { key: "mrrFin", label: "MRR fin de mois (FCFA)", kind: "amount", required: true },
    { key: "mrrPerdu", label: "MRR perdu (résiliations + baisses) (FCFA)", kind: "amount", required: true, crossRules: [{ op: "lte", other: "mrrDebut", against: "au MRR de début de mois" }] },
    { key: "clientsDebut", label: "Clients actifs début de mois", kind: "integer", required: true },
    { key: "clientsPerdus", label: "Clients perdus", kind: "integer", required: true, crossRules: [{ op: "lte", other: "clientsDebut", against: "aux clients actifs de début de mois" }] },
    { key: "nouveauxClients", label: "Nouveaux clients", kind: "integer", required: true },
    { key: "depensesAcquisition", label: "Dépenses marketing et commerciales (FCFA)", kind: "amount", required: true },
    { key: "margeBrutePct", label: "Marge brute du produit %", kind: "percent", hint: "Utilisée pour la LTV ; valeur par défaut paramétrable par client." },
    { key: "tpv", label: "Volume de transactions (TPV, si fintech)", kind: "amount" },
    { key: "revenuTransactions", label: "Revenu sur transactions (si fintech)", kind: "amount", requiredIf: "tpv" },
  ],
};

/** Données au niveau de la société : une ligne. La trésorerie peut être négative. */
const TRESORERIE: SheetDef = {
  name: "Tresorerie",
  label: "Trésorerie de la société",
  rows: "single",
  columns: [
    { key: "encaissementsTotaux", label: "Encaissements totaux du mois (FCFA)", kind: "amount", required: true },
    { key: "decaissementsTotaux", label: "Décaissements totaux du mois (FCFA)", kind: "amount", required: true },
    { key: "tresorerieFin", label: "Trésorerie disponible fin de mois (FCFA)", kind: "amount", required: true, allowNegative: true },
  ],
};

export const techMensuel: TemplateDef = {
  id: "tech_mensuel",
  version: 1,
  sector: "TECH_FINTECH",
  label: "Tech / Fintech — mensuel",
  sheets: [SAISIE, TRESORERIE],
};
