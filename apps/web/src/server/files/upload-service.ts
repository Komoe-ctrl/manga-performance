import {
  FILE_KINDS,
  MAX_UPLOAD_BYTES,
  SIGNATURE_BYTES,
  detectFileKind,
  extensionOf,
  isKeyOfClient,
  newStorageKey,
  validateUploadRequest,
  type FileKind,
} from "@manga/core/files";
import { DomainError } from "../domain-error";
import { UPLOAD_URL_SECONDS, type ObjectStorage } from "../storage/object-storage";

export type FileErrorCode = "EMPTY" | "TOO_LARGE" | "TYPE_NOT_ALLOWED" | "TYPE_MISMATCH" | "FILE_MISSING" | "INVALID_CONTENT" | "INVALID_KEY";

const MESSAGES: Record<FileErrorCode, string> = {
  EMPTY: "Le fichier est vide.",
  TOO_LARGE: "Le fichier dépasse la taille maximale de 25 Mo.",
  TYPE_NOT_ALLOWED: "Type de fichier non autorisé. Formats acceptés : PDF, Excel (XLSX), Word (DOCX), PNG et JPG.",
  TYPE_MISMATCH: "Le type du fichier ne correspond pas à son extension.",
  FILE_MISSING: "Le fichier n'a pas été reçu. Réessayez l'envoi.",
  INVALID_CONTENT: "Le contenu du fichier ne correspond pas à son type. Il a été refusé.",
  INVALID_KEY: "Référence de fichier invalide.",
};

export class FileError extends DomainError {
  constructor(code: FileErrorCode) {
    super(code, MESSAGES[code]);
    this.name = "FileError";
  }
}

export interface UploadTicket {
  key: string;
  uploadUrl: string;
  /** Headers the browser must send with the PUT, exactly. */
  headers: Record<string, string>;
  expiresInSeconds: number;
  maxBytes: number;
}

export interface VerifiedUpload {
  key: string;
  kind: FileKind;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Two-step uploads (spec, section 5). 1) `requestUpload` checks the declared name, type
 * and size and returns a presigned PUT whose signature includes the exact size and type.
 * 2) once the browser has uploaded, `verifyUploaded` reads the file back: size, magic
 * number (the extension is not trusted) and SHA-256. A file that fails is deleted.
 */
export function createUploadService({ storage }: { storage: ObjectStorage }) {
  return {
    async requestUpload(clientId: string, input: { filename: string; mimeType: string; sizeBytes: number }): Promise<UploadTicket> {
      const check = validateUploadRequest(input);
      if (!check.ok) throw new FileError(check.reason);

      const key = newStorageKey(clientId, FILE_KINDS[check.kind].extensions[0]!);
      const uploadUrl = await storage.presignUpload({
        key,
        contentType: check.mime,
        contentLength: input.sizeBytes,
        expiresInSeconds: UPLOAD_URL_SECONDS,
      });
      return { key, uploadUrl, headers: { "Content-Type": check.mime }, expiresInSeconds: UPLOAD_URL_SECONDS, maxBytes: MAX_UPLOAD_BYTES };
    },

    async verifyUploaded(clientId: string, key: string): Promise<VerifiedUpload> {
      // A client can only ever attach files that live under its own prefix.
      if (!isKeyOfClient(key, clientId)) throw new FileError("INVALID_KEY");

      const head = await storage.head(key);
      if (!head) throw new FileError("FILE_MISSING");

      const reject = async (code: FileErrorCode): Promise<never> => {
        await storage.delete(key).catch(() => undefined);
        throw new FileError(code);
      };
      if (head.size === 0) return reject("EMPTY");
      if (head.size > MAX_UPLOAD_BYTES) return reject("TOO_LARGE");

      const expected = (Object.keys(FILE_KINDS) as FileKind[]).find((kind) => FILE_KINDS[kind].extensions.includes(extensionOf(key)));
      const detected = detectFileKind(await storage.readHead(key, SIGNATURE_BYTES));
      if (!expected || detected !== expected) return reject("INVALID_CONTENT");

      return {
        key,
        kind: detected,
        mimeType: FILE_KINDS[detected].mime,
        sizeBytes: head.size,
        checksum: await storage.sha256(key),
      };
    },
  };
}

export type UploadService = ReturnType<typeof createUploadService>;
