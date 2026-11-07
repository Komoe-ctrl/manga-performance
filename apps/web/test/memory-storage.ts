import { createHash } from "node:crypto";
import type { ObjectStorage } from "@/server/storage/object-storage";

/** In-memory storage with the same contract as the S3 one. `put` plays the browser's upload. */
export class MemoryStorage implements ObjectStorage {
  objects = new Map<string, Uint8Array>();
  deleted: string[] = [];
  uploads: { key: string; contentType: string; contentLength: number; expiresInSeconds?: number }[] = [];
  downloads: { key: string; filename: string; expiresInSeconds?: number }[] = [];

  put(key: string, bytes: Uint8Array | string) {
    this.objects.set(key, typeof bytes === "string" ? new Uint8Array(Buffer.from(bytes, "latin1")) : bytes);
  }

  async presignUpload(input: { key: string; contentType: string; contentLength: number; expiresInSeconds?: number }) {
    this.uploads.push(input);
    return `https://storage.test/upload/${input.key}?signed=1`;
  }

  async presignDownload(input: { key: string; filename: string; expiresInSeconds?: number }) {
    this.downloads.push(input);
    return `https://storage.test/download/${input.key}?signed=1&expires=${input.expiresInSeconds ?? 300}`;
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { size: object.length } : null;
  }

  async readHead(key: string, bytes: number) {
    return this.objects.get(key)?.subarray(0, bytes) ?? new Uint8Array();
  }

  async sha256(key: string) {
    return createHash("sha256").update(this.objects.get(key) ?? new Uint8Array()).digest("hex");
  }

  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

/** Minimal valid-looking files, recognised by their signature. */
export const FILES = {
  pdf: "%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n",
  png: "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR",
  jpg: "\xff\xd8\xff\xe0\x00\x10JFIF",
  docx: "PK\x03\x04\x14\x00\x06\x00[Content_Types].xml\x00word/document.xml",
  xlsx: "PK\x03\x04\x14\x00\x06\x00[Content_Types].xml\x00xl/workbook.xml",
  exe: "MZ\x90\x00\x03\x00\x00\x00 This program cannot be run in DOS mode",
};
