import { formatNumberFr } from "../cells";
import type { CoherenceCheck, Issue, SheetDef, TemplateDef } from "../types";

const SHEET: SheetDef = {
  name: "Saisie_Chantiers",
  label: "Chantiers actifs",
  rows: "multiple",
  columns: [
    { key: "codeChantier", label: "Code chantier", kind: "text", required: true, uniqueInFile: true, hint: "Un même code revient chaque mois : il sert à suivre le chantier dans le temps." },
    { key: "nomChantier", label: "Nom du chantier", kind: "text", required: true },
    { key: "budgetInitial", label: "Budget initial (FCFA)", kind: "amount", required: true, gt: 0 },
    { key: "coutsReelsCumules", label: "Coûts réels cumulés (FCFA)", kind: "amount", required: true },
    { key: "avancementPhysique", label: "Avancement physique %", kind: "percent", required: true },
    // TODO(client): définition de l'avancement financier (coûts engagés / budget, ou CA facturé / montant du marché).
    { key: "avancementFinancier", label: "Avancement financier %", kind: "percent", required: true },
    { key: "caFacture", label: "CA facturé cumulé (FCFA)", kind: "amount", required: true },
    // TODO(client): ajout nécessaire au calcul de la marge prévue.
    { key: "prixMarche", label: "Montant du marché HT (FCFA)", kind: "amount", required: true, gt: 0 },
  ],
};

const warn = (row: number | null, code: string, message: string, column?: string, label?: string): Issue => ({
  severity: "warning",
  sheet: SHEET.name,
  row,
  column: column ?? null,
  columnLabel: label ?? null,
  value: null,
  code,
  message: row === null ? message : `Ligne ${row}${label ? `, ${label}` : ""} : ${message}`,
});

/** Avertissements de cohérence avec le mois précédent (avenant §4.1) : jamais un rejet. */
const progressOverTime: CoherenceCheck = (rows, ctx, rowNumbers) => {
  const previous = ctx.previous?.[SHEET.name];
  if (!previous || previous.length === 0) return [];
  const before = new Map(previous.map((r) => [String(r.codeChantier), r]));
  const current = rows[SHEET.name] ?? [];
  const numbers = rowNumbers[SHEET.name] ?? [];
  const out: Issue[] = [];
  const present = new Set<string>();

  current.forEach((row, i) => {
    const code = String(row.codeChantier);
    present.add(code);
    const prev = before.get(code);
    if (!prev) return;
    const cost = row.coutsReelsCumules as number;
    const prevCost = prev.coutsReelsCumules as number;
    if (cost < prevCost) {
      out.push(warn(numbers[i]!, "COST_DECREASED", `${formatNumberFr(cost)} est inférieur au mois précédent (${formatNumberFr(prevCost)}) : un coût cumulé ne devrait pas baisser.`, "coutsReelsCumules", "Coûts réels cumulés (FCFA)"));
    }
    const progress = row.avancementPhysique as number;
    const prevProgress = prev.avancementPhysique as number;
    if (progress < prevProgress) {
      out.push(warn(numbers[i]!, "PROGRESS_DECREASED", `${formatNumberFr(progress)} % est inférieur au mois précédent (${formatNumberFr(prevProgress)} %).`, "avancementPhysique", "Avancement physique %"));
    }
  });

  for (const prev of previous) {
    const code = String(prev.codeChantier);
    if (!present.has(code)) out.push(warn(null, "SITE_MISSING", `Chantier ${code} non déclaré (terminé ?).`));
  }
  return out;
};

export const btpChantiers: TemplateDef = {
  id: "btp_chantiers",
  version: 1,
  sector: "BTP",
  label: "BTP — chantiers actifs",
  sheets: [SHEET],
  coherence: [progressOverTime],
};
