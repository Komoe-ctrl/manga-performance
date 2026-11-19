import type { CoherenceCheck, Issue, SheetDef, TemplateDef } from "../types";

/** Une ligne par livraison : « 02,12,14/10 » dans une cellule est interdit (avenant §4.6). */
export const HOTEL_CPRO_SHEET: SheetDef = {
  name: "Saisie_CPRO",
  label: "Livraisons de consommables (CPRO)",
  rows: "multiple",
  columns: [
    { key: "produit", label: "Produit", kind: "enum", required: true, optionsFrom: { name: "produits" }, hint: "Liste issue du catalogue produits du client." },
    { key: "uniteLivraison", label: "Unité de livraison", kind: "enum", required: true, optionsFrom: { name: "unites", by: "produit" }, hint: "Unités déclarées pour le produit (paquet, bidon 4 L, litre…)." },
    { key: "quantite", label: "Quantité livrée (en unités de livraison)", kind: "decimal", required: true, gt: 0 },
    { key: "dateLivraison", label: "Date de livraison", kind: "date", required: true },
    { key: "numeroBon", label: "N° bon de livraison", kind: "text", required: true, uniqueWithin: "produit", duplicate: "warning" },
    { key: "observations", label: "Observations", kind: "text" },
  ],
};

/** Population accueillie, nécessaire au calcul du CPRA (avenant §4.7). */
export const HOTEL_POPULATION_SHEET: SheetDef = {
  name: "Population",
  label: "Population accueillie",
  rows: "single",
  columns: [
    { key: "clientsTotal", label: "Clients total", kind: "integer", required: true, crossRules: [{ op: "eq", other: ["clientsPass", "clientsLongSejour"], against: "à la somme des clients PASS et long séjour" }] },
    { key: "clientsPass", label: "Clients PASS", kind: "integer", required: true },
    { key: "clientsLongSejour", label: "Clients long séjour", kind: "integer", required: true },
  ],
};

/**
 * TODO(client): un mois sans livraison est-il possible (stock suffisant) ? Si oui, ajouter une case
 * « Aucune livraison ce mois » qui force le CPRO à 0. En attendant : le produit est « manquant ».
 */
const missingDeliveries: CoherenceCheck = (rows, ctx) => {
  const expected = ctx.options?.produits;
  if (!Array.isArray(expected)) return [];
  const delivered = new Set((rows[HOTEL_CPRO_SHEET.name] ?? []).map((r) => String(r.produit)));
  return (expected as readonly string[])
    .filter((p) => !delivered.has(p))
    .map<Issue>((p) => ({
      severity: "warning",
      sheet: HOTEL_CPRO_SHEET.name,
      row: null,
      column: null,
      columnLabel: null,
      value: null,
      code: "NO_DELIVERY",
      message: `Aucune livraison déclarée pour ${p}.`,
    }));
};

/** Un seul dépôt par hôtel et par mois : les deux feuilles sont dans le même fichier. */
export const hotelConsommablesCpro: TemplateDef = {
  id: "hotel_consommables_cpro",
  version: 1,
  sector: "HOTELLERIE",
  label: "Hôtel — Consommables (CPRO) et population",
  sheets: [HOTEL_CPRO_SHEET, HOTEL_POPULATION_SHEET],
  coherence: [missingDeliveries],
};
