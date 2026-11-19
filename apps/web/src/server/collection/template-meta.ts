import { signToken, verifyToken } from "@manga/core/signed-tokens";
import type { Issue } from "@manga/core/collection";

/** Nom de la feuille technique masquée, qui porte l'identité du fichier généré. */
export const META_SHEET = "_meta";
const PURPOSE = "collection-template";

export interface TemplateMeta {
  templateId: string;
  version: number;
  entityId: string;
  periodId: string;
}

/** Jeton signé (HMAC) à écrire dans la feuille `_meta` : un fichier ne peut pas être « redirigé » sur une autre période. */
export function signMeta(meta: TemplateMeta, secret: string): string {
  return signToken(PURPOSE, { ...meta }, secret);
}

export type MetaStatus = { status: "absent" } | { status: "invalid" } | ({ status: "valid" } & TemplateMeta);

export function readMeta(token: string | null, secret: string): MetaStatus {
  if (!token) return { status: "absent" };
  const payload = verifyToken<Record<string, unknown>>(PURPOSE, token, secret);
  if (!payload) return { status: "invalid" };
  const { templateId, version, entityId, periodId } = payload;
  if (typeof templateId !== "string" || typeof version !== "number" || typeof entityId !== "string" || typeof periodId !== "string") return { status: "invalid" };
  return { status: "valid", templateId, version, entityId, periodId };
}

const issue = (severity: Issue["severity"], code: string, message: string): Issue => ({ severity, sheet: META_SHEET, row: null, column: null, columnLabel: null, value: null, code, message });

/**
 * Avenant §5 : si `_meta` est présent et signé, l'entité, la période et le modèle doivent
 * correspondre (erreur de fichier : mauvais mois, mauvais hôtel). Absent ou illisible : le fichier
 * est contrôlé quand même, avec un avertissement.
 */
export function checkMeta(meta: MetaStatus, expected: Omit<TemplateMeta, "version">): Issue[] {
  if (meta.status === "absent") {
    return [issue("warning", "META_ABSENT", "Le fichier ne provient pas du modèle de la plateforme (feuille technique absente) : il est contrôlé quand même.")];
  }
  if (meta.status === "invalid") {
    return [issue("warning", "META_INVALID", "La feuille technique du fichier est illisible ou a été modifiée : le fichier est contrôlé quand même.")];
  }
  const out: Issue[] = [];
  if (meta.templateId !== expected.templateId) out.push(issue("error", "META_WRONG_TEMPLATE", "Ce fichier a été généré pour un autre modèle de collecte : utilisez le modèle de cette collecte."));
  if (meta.entityId !== expected.entityId) out.push(issue("error", "META_WRONG_ENTITY", "Ce fichier a été généré pour une autre entité : utilisez le modèle de votre établissement."));
  if (meta.periodId !== expected.periodId) out.push(issue("error", "META_WRONG_PERIOD", "Ce fichier a été généré pour une autre période : téléchargez le modèle de la période attendue."));
  return out;
}
