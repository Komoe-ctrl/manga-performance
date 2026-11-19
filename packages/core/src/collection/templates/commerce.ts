import { formatNumberFr } from "../cells";
import type { CoherenceCheck, Issue, SheetDef, TemplateDef } from "../types";

const SHEET: SheetDef = {
  name: "Saisie_Commerce",
  label: "Saisie magasin",
  rows: "single",
  columns: [
    { key: "caHt", label: "CA HT (FCFA)", kind: "amount", required: true },
    // TODO(client): la plateforme demande les achats et calcule le coût des ventes (stock début + achats − stock fin).
    { key: "achats", label: "Achats de marchandises du mois (FCFA)", kind: "amount", required: true },
    { key: "stockDebut", label: "Stock début (FCFA)", kind: "amount", required: true },
    { key: "stockFin", label: "Stock fin (FCFA)", kind: "amount", required: true },
    { key: "chargesExploitation", label: "Charges d'exploitation (FCFA)", kind: "amount", required: true },
    { key: "nombreTransactions", label: "Nombre de transactions", kind: "integer" },
  ],
};

/** Avertissement si le stock début diffère du stock fin du mois précédent (avenant §4.4). */
const stockContinuity: CoherenceCheck = (rows, ctx, rowNumbers) => {
  const previous = ctx.previous?.[SHEET.name]?.[0];
  const current = rows[SHEET.name]?.[0];
  if (!previous || !current) return [];
  const start = current.stockDebut as number;
  const lastEnd = previous.stockFin as number;
  if (start === lastEnd) return [];
  const row = rowNumbers[SHEET.name]?.[0] ?? null;
  return [
    {
      severity: "warning",
      sheet: SHEET.name,
      row,
      column: "stockDebut",
      columnLabel: "Stock début (FCFA)",
      value: String(start),
      code: "STOCK_DISCONTINUITY",
      message: `${row === null ? "" : `Ligne ${row}, Stock début (FCFA) : `}${formatNumberFr(start)} diffère du stock fin du mois précédent (${formatNumberFr(lastEnd)}).`,
    } satisfies Issue,
  ];
};

/** Un dépôt par magasin (avenant §4.4). TODO(client) : faut-il un niveau « catégorie » ? */
export const commerceMensuel: TemplateDef = {
  id: "commerce_mensuel",
  version: 1,
  sector: "COMMERCE",
  label: "Commerce — mensuel",
  sheets: [SHEET],
  coherence: [stockContinuity],
};
