import { validateSubmission, type Issue, type PeriodContext, type TemplateDef, type ValidationResult } from "@manga/core/collection";
import { checkMeta, type TemplateMeta } from "./template-meta";
import { readWorkbookCells } from "./workbook-reader";

/**
 * Contrôle complet d'un classeur : identité du fichier (`_meta`), en-têtes, puis contenu. Une erreur
 * de fichier (mauvaise période, mauvaise entité, en-tête manquant) arrête le contrôle : les erreurs
 * de cellules qui en découleraient ne feraient que noyer le message utile.
 */
export async function checkWorkbook(input: {
  buffer: Buffer | ArrayBuffer;
  template: TemplateDef;
  expected: Omit<TemplateMeta, "version" | "templateId">;
  ctx: PeriodContext;
  secret: string;
}): Promise<ValidationResult> {
  const { template, expected, ctx } = input;
  const read = await readWorkbookCells(input.buffer, template, input.secret);

  const fileIssues: Issue[] = [...checkMeta(read.meta, { templateId: template.id, ...expected }), ...read.issues];
  if (fileIssues.some((i) => i.severity === "error")) {
    return {
      ok: false,
      errors: fileIssues.filter((i) => i.severity === "error"),
      warnings: fileIssues.filter((i) => i.severity === "warning"),
      truncated: false,
      rows: Object.fromEntries(template.sheets.map((s) => [s.name, []])),
    };
  }

  const result = validateSubmission(template, read.sheets, ctx);
  return { ...result, warnings: [...fileIssues, ...result.warnings] };
}
