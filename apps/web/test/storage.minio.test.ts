import { randomBytes } from "node:crypto";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUploadService, FileError } from "@/server/files/upload-service";
import { createS3Storage } from "@/server/storage/object-storage";
import { FILES } from "./memory-storage";

/**
 * The same storage contract, against a real S3 server (MinIO). It proves what a fake
 * cannot: that the signatures really bind size and type, that links expire, and that
 * a link cannot be bent into reaching another object.
 */
const config = {
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKey: process.env.S3_ACCESS_KEY!,
  secretKey: process.env.S3_SECRET_KEY!,
};

const reachable = await fetch(`${config.endpoint}/minio/health/live`, { signal: AbortSignal.timeout(2000) })
  .then((r) => r.ok)
  .catch(() => false);
if (!reachable && process.env.REQUIRE_S3) throw new Error(`REQUIRE_S3 is set but ${config.endpoint} is unreachable`);

describe.skipIf(!reachable)("S3 storage (MinIO)", () => {
  const storage = createS3Storage(config);
  const prefix = `clients/it-${randomBytes(6).toString("hex")}`;
  const keys: string[] = [];
  const newKey = (ext = "pdf") => {
    const key = `${prefix}/${randomBytes(12).toString("base64url")}.${ext}`;
    keys.push(key);
    return key;
  };
  const pdf = Buffer.from(FILES.pdf + "x".repeat(2000), "latin1");

  beforeAll(async () => {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
    await client.send(new CreateBucketCommand({ Bucket: config.bucket })).catch((error) => {
      if (!/AlreadyOwned|AlreadyExists/.test(String(error.name))) throw error;
    });
  });
  afterAll(async () => {
    await Promise.all(keys.map((key) => storage.delete(key).catch(() => undefined)));
  });

  const put = (url: string, body: Uint8Array, headers: Record<string, string>) =>
    fetch(url, { method: "PUT", body: body as unknown as BodyInit, headers });

  it("accepts an upload that matches the signed size and type, and reads it back", async () => {
    const key = newKey();
    const url = await storage.presignUpload({ key, contentType: "application/pdf", contentLength: pdf.length });
    expect((await put(url, pdf, { "Content-Type": "application/pdf" })).status).toBe(200);

    expect(await storage.head(key)).toEqual({ size: pdf.length });
    expect(Buffer.from(await storage.readHead(key, 8)).toString("latin1")).toBe("%PDF-1.7");
    expect(await storage.sha256(key)).toMatch(/^[0-9a-f]{64}$/);
    expect((await storage.readHead(key, 4)).length).toBe(4);
  });

  it("refuses an upload bigger than what was signed", async () => {
    const key = newKey();
    const url = await storage.presignUpload({ key, contentType: "application/pdf", contentLength: 100 });
    const response = await put(url, pdf, { "Content-Type": "application/pdf" });
    expect(response.status).toBe(403);
    expect(await storage.head(key)).toBeNull();
  });

  it("refuses another content type than the signed one", async () => {
    const key = newKey();
    const url = await storage.presignUpload({ key, contentType: "application/pdf", contentLength: pdf.length });
    expect((await put(url, pdf, { "Content-Type": "text/html" })).status).toBe(403);
    expect(await storage.head(key)).toBeNull();
  });

  it("refuses an unsigned request, and a link bent towards another key", async () => {
    const key = newKey();
    const url = await storage.presignUpload({ key, contentType: "application/pdf", contentLength: pdf.length });
    expect((await put(url.split("?")[0]!, pdf, { "Content-Type": "application/pdf" })).status).toBe(403);
    const other = url.replace(key, `${prefix}/other.pdf`);
    expect((await put(other, pdf, { "Content-Type": "application/pdf" })).status).toBe(403);
  });

  it("serves a download as an attachment, and refuses the bare object URL (private bucket)", async () => {
    const key = newKey();
    await put(await storage.presignUpload({ key, contentType: "application/pdf", contentLength: pdf.length }), pdf, { "Content-Type": "application/pdf" });

    const link = await storage.presignDownload({ key, filename: "Bilan été.pdf" });
    const response = await fetch(link);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="Bilan _t_.pdf"; filename*=UTF-8''Bilan%20%C3%A9t%C3%A9.pdf`);
    expect(Buffer.from(await response.arrayBuffer()).equals(pdf)).toBe(true);

    expect((await fetch(link.split("?")[0]!)).status).toBe(403);
    expect((await fetch(link.replace(key, `${prefix}/missing.pdf`))).status).toBe(403);
  });

  it("makes download links expire", async () => {
    const key = newKey();
    await put(await storage.presignUpload({ key, contentType: "application/pdf", contentLength: pdf.length }), pdf, { "Content-Type": "application/pdf" });
    const link = await storage.presignDownload({ key, filename: "a.pdf", expiresInSeconds: 1 });
    expect((await fetch(link)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await fetch(link)).status).toBe(403);
  });

  it("deletes objects, and reports missing ones as absent", async () => {
    const key = newKey();
    await put(await storage.presignUpload({ key, contentType: "application/pdf", contentLength: pdf.length }), pdf, { "Content-Type": "application/pdf" });
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  describe("full upload flow", () => {
    const uploads = createUploadService({ storage });
    const clientId = `it-${randomBytes(4).toString("hex")}`;

    async function upload(filename: string, bytes: Uint8Array) {
      const ticket = await uploads.requestUpload(clientId, { filename, mimeType: "", sizeBytes: bytes.length });
      keys.push(ticket.key);
      const response = await put(ticket.uploadUrl, bytes, ticket.headers);
      expect(response.status).toBe(200);
      return ticket;
    }

    it("verifies a genuine file: kind, size and checksum", async () => {
      const ticket = await upload("Rapport.pdf", pdf);
      const verified = await uploads.verifyUploaded(clientId, ticket.key);
      expect(verified).toMatchObject({ kind: "pdf", mimeType: "application/pdf", sizeBytes: pdf.length });
      expect(verified.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects, and deletes, an executable uploaded under a .pdf name", async () => {
      const ticket = await upload("rapport.pdf", Buffer.from(FILES.exe, "latin1"));
      await expect(uploads.verifyUploaded(clientId, ticket.key)).rejects.toMatchObject({ code: "INVALID_CONTENT" });
      expect(await storage.head(ticket.key)).toBeNull();
    });

    it("recognises Office, PNG and JPEG files", async () => {
      for (const [name, file, kind] of [["t.xlsx", FILES.xlsx, "xlsx"], ["n.docx", FILES.docx, "docx"], ["l.png", FILES.png, "png"], ["p.jpg", FILES.jpg, "jpg"]] as const) {
        const ticket = await upload(name, Buffer.from(file, "latin1"));
        expect((await uploads.verifyUploaded(clientId, ticket.key)).kind).toBe(kind);
      }
    });

    it("reports an upload that never happened", async () => {
      const ticket = await uploads.requestUpload(clientId, { filename: "a.pdf", mimeType: "", sizeBytes: 10 });
      await expect(uploads.verifyUploaded(clientId, ticket.key)).rejects.toBeInstanceOf(FileError);
    });
  });
});
