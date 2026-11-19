import type { SheetDef, TemplateDef } from "../types";

const MENSUEL: SheetDef = {
  name: "Saisie_Mensuelle",
  label: "Saisie mensuelle",
  rows: "single",
  columns: [
    { key: "nombreChambres", label: "Nombre de chambres", kind: "integer", required: true, gt: 0, hint: "Pré-rempli depuis la fiche de l'entité, modifiable." },
    // TODO(client): chambresVendues n'est pas dans le fichier 03 du client, ajouté pour le taux d'occupation et l'ADR.
    {
      key: "chambresVendues",
      label: "Chambres vendues (nuitées)",
      kind: "integer",
      required: true,
      crossRules: [{ op: "lte", other: "nombreChambres", times: "days", against: "aux chambres disponibles" }],
      hint: "Au plus : nombre de chambres × nombre de jours de la période.",
    },
    { key: "caChambres", label: "CA Chambres HT", kind: "amount", required: true },
    { key: "revenusTotaux", label: "Revenus totaux d'exploitation HT", kind: "amount", required: true, crossRules: [{ op: "gte", other: "caChambres", against: "au CA Chambres HT" }] },
    { key: "chargesDepartementales", label: "Charges départementales", kind: "amount", required: true },
    { key: "chargesNonReparties", label: "Charges non réparties", kind: "amount", required: true },
    { key: "commissionsOta", label: "Commissions OTA", kind: "amount" },
  ],
};

/** Le GOP est calculé par la plateforme, jamais saisi (avenant §4.2). */
export const hotelMensuel: TemplateDef = {
  id: "hotel_mensuel",
  version: 1,
  sector: "HOTELLERIE",
  label: "Hôtel — KPI mensuels",
  sheets: [MENSUEL],
};
