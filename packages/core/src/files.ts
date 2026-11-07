import { randomBytes } from "node:crypto";

/** Upload rules (spec, section 5): PDF, XLSX, DOCX, PNG, JPG, 25 MB at most. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type FileKind = "pdf" | "xlsx" | "docx" | "png" | "jpg";

export const FILE_KINDS: Record<FileKind, { mime: string; extensions: readonly string[] }> = {
  pdf: { mime: "application/pdf", extensions: ["pdf"] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"] },
  png: { mime: "image/png", extensions: ["png"] },
  jpg: { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
};

const KINDS = Object.keys(FILE_KINDS) as FileKind[];

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function kindFromExtension(filename: string): FileKind | null {
  const extension = extensionOf(filename);
  return KINDS.find((kind) => FILE_KINDS[kind].extensions.includes(extension)) ?? null;
}

export type UploadCheck =
  | { ok: true; kind: FileKind; mime: string }
  | { ok: false; reason: "EMPTY" | "TOO_LARGE" | "TYPE_NOT_ALLOWED" | "TYPE_MISMATCH" };

/**
 * First gate, before anything is uploaded: the declared name, type and size. It cannot be
 * trusted on its own (the browser decides what it declares), so the bytes are checked
 * again once uploaded (`detectFileKind`).
 */
export function validateUploadRequest(input: { filename: string; mimeType: string; sizeBytes: number }): UploadCheck {
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, reason: "EMPTY" };
  if (input.sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, reason: "TOO_LARGE" };
  const kind = kindFromExtension(input.filename);
  if (!kind) return { ok: false, reason: "TYPE_NOT_ALLOWED" };
  const declared = input.mimeType.split(";")[0]!.trim().toLowerCase();
  // Some browsers send nothing (or a generic type) for Office files: the extension decides then.
  const generic = declared === "" || declared === "application/octet-stream";
  if (!generic && declared !== FILE_KINDS[kind].mime && !(kind === "jpg" && declared === "image/jpg")) {
    return { ok: false, reason: "TYPE_MISMATCH" };
  }
  return { ok: true, kind, mime: FILE_KINDS[kind].mime };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((value, index) => bytes[index] === value);

/**
 * Identifies a file from its first bytes (its "magic number"), whatever it is called.
 * Office files are ZIP containers: they must carry `[Content_Types].xml` and the folder
 * of a Word (`word/`) or Excel (`xl/`) document. Anything else returns `null`.
 */
export function detectFileKind(head: Uint8Array): FileKind | null {
  if (startsWith(head, PNG_SIGNATURE)) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpg";

  // PDF readers accept the header anywhere in the first kilobyte.
  const start = Buffer.from(head.subarray(0, 1024)).toString("latin1");
  if (start.includes("%PDF-")) return "pdf";

  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const text = Buffer.from(head.subarray(0, 65_536)).toString("latin1");
    if (!text.includes("[Content_Types].xml")) return null;
    const word = text.indexOf("word/");
    const excel = text.indexOf("xl/");
    if (word === -1 && excel === -1) return null;
    if (word === -1) return "xlsx";
    if (excel === -1) return "docx";
    return word < excel ? "docx" : "xlsx";
  }
  return null;
}

/** Number of leading bytes needed by `detectFileKind`. */
export const SIGNATURE_BYTES = 65_536;

/** A name safe to put in a `Content-Disposition` header: no path, no control characters. */
export function sanitizeFilename(name: string, fallback = "fichier"): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>:*?|;,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return base.slice(0, 100) || fallback;
}

/** Non-guessable storage key: `clients/{clientId}/{random}.{ext}` (spec, section 5). */
export function newStorageKey(clientId: string, extension: string): string {
  return `clients/${clientId}/${randomBytes(18).toString("base64url")}.${extension}`;
}

/** True when a key lives under the client's own prefix (and cannot escape it). */
export function isKeyOfClient(key: string, clientId: string): boolean {
  return key.startsWith(`clients/${clientId}/`) && !key.includes("..") && !key.slice(`clients/${clientId}/`.length).includes("/");
}

/** `Content-Disposition` value forcing a download, with an RFC 5987 UTF-8 name. */
export function attachmentDisposition(filename: string): string {
  const clean = sanitizeFilename(filename);
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/\\/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
