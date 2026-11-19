import { validateSubmission } from "./engine";
import { checkMeta, type TemplateMeta } from "./meta";
import { DEFAULT_READ_LIMITS, WorkbookGuardError, readWorkbookCells, type ReadLimits } from "./workbook-reader";
import type { Issue, PeriodContext, TemplateDef, ValidationResult } from "./types";

const empty = (template: TemplateDef) => Object.fromEntries(template.sheets.map((s) => [s.name, []]));

const fileIssue = (severity: Issue["severity"], code: string, message: string): Issue => ({ severity, sheet: "Fichier", row: null, column: null, columnLabel: null, value: null, code, message });

/**
 * Contrôle complet d'un classeur : garde-fous, identité du fichier (`_meta`), en-têtes, puis contenu.
 * Une erreur de fichier (macro, mauvaise période, mauvaise entité, en-tête manquant) arrête le
 * contrôle : les erreurs de cellules qui en découleraient ne feraient que noyer le message utile.
 */
export async function checkWorkbook(input: {
  buffer: Uint8Array;
  template: TemplateDef;
  expected: Omit<TemplateMeta, "version" | "templateId">;
  ctx: PeriodContext;
  secret: string;
  limits?: ReadLimits;
}): Promise<ValidationResult> {
  const { template, expected, ctx } = input;
  let read;
  try {
    read = await readWorkbookCells(input.buffer, template, input.secret, input.limits ?? DEFAULT_READ_LIMITS);
  } catch (error) {
    if (!(error instanceof WorkbookGuardError)) throw error;
    return { ok: false, errors: [fileIssue("error", error.code, error.message)], warnings: [], truncated: false, rows: empty(template) };
  }

  const fileIssues: Issue[] = [...checkMeta(read.meta, { templateId: template.id, ...expected }), ...read.issues];
  if (fileIssues.some((i) => i.severity === "error")) {
    return {
      ok: false,
      errors: fileIssues.filter((i) => i.severity === "error"),
      warnings: fileIssues.filter((i) => i.severity === "warning"),
      truncated: false,
      rows: empty(template),
    };
  }

  const result = validateSubmission(template, read.sheets, ctx);
  return { ...result, warnings: [...fileIssues, ...result.warnings] };
}
