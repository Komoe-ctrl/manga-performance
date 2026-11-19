import type { SheetDef, TemplateDef } from "../types";

const SHEET: SheetDef = {
  name: "Saisie_Restaurant",
  label: "Saisie restaurant",
  rows: "single",
  columns: [
    { key: "caHt", label: "CA HT (FCFA)", kind: "amount", required: true },
    // TODO(client): « coût matières » = matières consommées (stock initial + achats − stock final) ou achats du mois ?
    { key: "coutMatieres", label: "Coût matières consommées (FCFA)", kind: "amount", required: true },
    { key: "chargesPersonnel", label: "Charges de personnel (FCFA)", kind: "amount", required: true },
    { key: "autresCharges", label: "Autres charges d'exploitation (FCFA)", kind: "amount", required: true },
    // TODO(client): conservé de la v1.0 pour le ticket moyen.
    { key: "nombreCouverts", label: "Nombre de couverts", kind: "integer" },
  ],
};

/** Un dépôt par établissement, une seule ligne (avenant §4.3). */
export const restoMensuel: TemplateDef = {
  id: "resto_mensuel",
  version: 1,
  sector: "RESTAURATION",
  label: "Restauration — mensuel",
  sheets: [SHEET],
};
