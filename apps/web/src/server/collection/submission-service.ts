import { extensionOf, sanitizeFilename } from "@manga/core/files";
import { getTemplate } from "@manga/core/collection";
import type { PrismaClient } from "@manga/db";
import { DomainError } from "../domain-error";
import { FileError, createUploadService, type UploadTicket } from "../files/upload-service";
import { recordAudit } from "../repositories/audit";
import type { Enqueuer } from "../queue";
import type { ObjectStorage } from "../storage/object-storage";
import { assertCanDeposit, assertEntityInScope, type CollectionActor } from "./scope";

/** Taille maximale d'un dépôt de collecte (avenant §7), plus stricte que les 25 Mo des autres fichiers. */
export const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Statuts de période qui acceptent un dépôt : attendu, en retard, ou rejeté (on corrige et on redépose). */
const OPEN_FOR_DEPOSIT = ["ATTENDU", "EN_RETARD", "REJETE"] as const;
type OpenStatus = (typeof OPEN_FOR_DEPOSIT)[number];
const isOpen = (status: string): status is OpenStatus => (OPEN_FOR_DEPOSIT as readonly string[]).includes(status);

const CLOSED_MESSAGES: Record<string, string> = {
  A_VENIR: "Cette période n'est pas encore ouverte aux dépôts.",
  EN_CONTROLE: "Un dépôt est déjà en cours de contrôle pour cette période : attendez son résultat.",
  VALIDE: "Cette période est déjà validée.",
  ACCEPTE_AVEC_RESERVE: "Cette période est déjà acceptée.",
};

export interface SubmissionDeps {
  prisma: PrismaClient;
  storage: ObjectStorage;
  queue: Pick<Enqueuer, "enqueueParseSubmission">;
  now?: () => Date;
}

/** Refuse tout sauf `.xlsx`, avec un message clair pour `.xlsm` et `.xls` (avenant §4.8). */
function assertXlsxName(filename: string) {
  const extension = extensionOf(filename);
  if (extension === "xlsx") return;
  if (extension === "xlsm") throw new DomainError("MACRO_NOT_ALLOWED", "Les classeurs avec macros (.xlsm) sont refusés : enregistrez le fichier au format .xlsx.");
  if (extension === "xls") throw new DomainError("OLD_FORMAT", "Le format Excel ancien (.xls) est refusé : enregistrez le fichier au format .xlsx.");
  throw new DomainError("TYPE_NOT_ALLOWED", "Seuls les fichiers Excel .xlsx sont acceptés pour la collecte.");
}

export function createSubmissionService(deps: SubmissionDeps) {
  const { prisma, storage, queue } = deps;
  const now = deps.now ?? (() => new Date());
  const uploads = createUploadService({ storage });

  /** Charge la période, applique `entityScope` (404 hors périmètre) puis les règles de dépôt. */
  async function loadDepositablePeriod(actor: CollectionActor, periodId: string) {
    const period = await prisma.collectionPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, status: true, plan: { select: { templateId: true, entity: { select: { id: true, clientId: true } } } } },
    });
    if (!period) throw new DomainError("NOT_FOUND", "Période introuvable.");
    await assertEntityInScope(prisma, actor, period.plan.entity.id);
    assertCanDeposit(actor);
    if (!getTemplate(period.plan.templateId)) throw new DomainError("NOT_FOUND", "Modèle de collecte inconnu.");
    if (!isOpen(period.status)) throw new DomainError("PERIOD_CLOSED", CLOSED_MESSAGES[period.status] ?? "Cette période n'accepte pas de dépôt.");
    return { ...period, status: period.status as OpenStatus };
  }

  return {
    /** Étape 1 : URL présignée (taille et type signés). Rien n'est créé en base. */
    async requestUpload(actor: CollectionActor, periodId: string, input: { filename: string; sizeBytes: number }): Promise<UploadTicket> {
      const period = await loadDepositablePeriod(actor, periodId);
      assertXlsxName(input.filename);
      if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new FileError("EMPTY");
      if (input.sizeBytes > MAX_SUBMISSION_BYTES) throw new DomainError("TOO_LARGE", "Le fichier dépasse la taille maximale de 10 Mo.");
      // The file lives under the prefix of the entity's own client (an admin deposits on its behalf).
      return uploads.requestUpload(period.plan.entity.clientId, { filename: input.filename, mimeType: XLSX_MIME, sizeBytes: input.sizeBytes });
    },

    /**
     * Étape 2, une fois le fichier envoyé : relit l'objet (taille, signature, SHA-256), crée la version
     * n+1, passe la période en `EN_CONTROLE` et met le contrôle en file. Les macros, les bombes et le
     * contenu sont contrôlés par le job.
     */
    async confirmUpload(actor: CollectionActor, periodId: string, input: { key: string; originalName: string }): Promise<{ submissionId: string; version: number }> {
      const period = await loadDepositablePeriod(actor, periodId);
      assertXlsxName(input.originalName);
      const template = getTemplate(period.plan.templateId)!;

      const verified = await uploads.verifyUploaded(period.plan.entity.clientId, input.key);
      if (verified.kind !== "xlsx") {
        await storage.delete(input.key).catch(() => undefined);
        throw new FileError("INVALID_CONTENT");
      }
      if (verified.sizeBytes > MAX_SUBMISSION_BYTES) {
        await storage.delete(input.key).catch(() => undefined);
        throw new DomainError("TOO_LARGE", "Le fichier dépasse la taille maximale de 10 Mo.");
      }

      const previousStatus = period.status;
      const created = await prisma
        .$transaction(async (tx) => {
          // Claim the period: two concurrent deposits cannot both pass.
          const claimed = await tx.collectionPeriod.updateMany({ where: { id: period.id, status: { in: [...OPEN_FOR_DEPOSIT] } }, data: { status: "EN_CONTROLE" } });
          if (claimed.count === 0) throw new DomainError("PERIOD_CLOSED", CLOSED_MESSAGES.EN_CONTROLE!);
          const last = await tx.submission.findFirst({ where: { periodId: period.id }, orderBy: { version: "desc" }, select: { version: true } });
          const version = (last?.version ?? 0) + 1;
          const submission = await tx.submission.create({
            data: {
              periodId: period.id,
              version,
              templateId: template.id,
              templateVersion: template.version,
              storageKey: verified.key,
              originalName: sanitizeFilename(input.originalName, "depot.xlsx"),
              sizeBytes: verified.sizeBytes,
              checksum: verified.checksum,
              uploadedBy: actor.userId,
              status: "EN_CONTROLE",
            },
            select: { id: true, version: true },
          });
          await recordAudit(tx, { actorId: actor.userId, action: "submission.upload", entity: "Submission", entityId: submission.id, diff: { periodId: period.id, version, sizeBytes: verified.sizeBytes } });
          return submission;
        })
        .catch((error: unknown) => {
          if ((error as { code?: string }).code === "P2002") throw new DomainError("PERIOD_CLOSED", CLOSED_MESSAGES.EN_CONTROLE!);
          throw error;
        });

      try {
        await queue.enqueueParseSubmission({ submissionId: created.id }, { dedupeKey: created.id });
      } catch (error) {
        // The check cannot start: give the period back so the deposit can be retried.
        await prisma.$transaction([
          prisma.submission.update({ where: { id: created.id }, data: { status: "ERREUR_TECHNIQUE" } }),
          prisma.collectionPeriod.update({ where: { id: period.id }, data: { status: previousStatus } }),
        ]);
        throw new DomainError("QUEUE_UNAVAILABLE", "Le contrôle n'a pas pu démarrer : réessayez dans quelques instants.", { cause: error instanceof Error ? error.name : "unknown" });
      }
      return { submissionId: created.id, version: created.version };
    },

    /**
     * Forçage admin (avenant §7) : accepte avec réserve une période rejetée. Le commentaire est
     * obligatoire et journalisé. Les lignes lues au mieux restent attachées au dépôt.
     */
    async forceAccept(adminId: string, periodId: string, comment: string): Promise<{ submissionId: string }> {
      const text = comment.trim();
      if (text.length < 5) throw new DomainError("VALIDATION", "Un commentaire est obligatoire pour accepter avec réserve (5 caractères au moins).");
      const period = await prisma.collectionPeriod.findUnique({ where: { id: periodId }, select: { id: true, status: true } });
      if (!period) throw new DomainError("NOT_FOUND", "Période introuvable.");
      if (period.status !== "REJETE") throw new DomainError("CONFLICT", "Seule une période rejetée peut être acceptée avec réserve.");
      const last = await prisma.submission.findFirst({ where: { periodId }, orderBy: { version: "desc" }, select: { id: true, status: true, version: true } });
      if (!last || last.status !== "REJETE") throw new DomainError("CONFLICT", "Le dernier dépôt n'est pas rejeté.");

      await prisma.$transaction(async (tx) => {
        const claimed = await tx.collectionPeriod.updateMany({ where: { id: periodId, status: "REJETE" }, data: { status: "ACCEPTE_AVEC_RESERVE" } });
        if (claimed.count === 0) throw new DomainError("CONFLICT", "Seule une période rejetée peut être acceptée avec réserve.");
        await tx.submission.update({ where: { id: last.id }, data: { status: "ACCEPTE_AVEC_RESERVE", reviewComment: text, reviewedBy: adminId } });
        await recordAudit(tx, { actorId: adminId, action: "submission.force", entity: "Submission", entityId: last.id, diff: { periodId, version: last.version, comment: text, at: now().toISOString() } });
      });
      return { submissionId: last.id };
    },
  };
}

export type SubmissionService = ReturnType<typeof createSubmissionService>;
