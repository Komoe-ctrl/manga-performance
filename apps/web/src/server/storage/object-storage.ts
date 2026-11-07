import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { attachmentDisposition } from "@manga/core/files";

/**
 * Private object storage (S3-compatible: OVH Object Storage, Cloudflare R2, MinIO in dev).
 * The bucket is private: files only leave through short-lived presigned URLs.
 */
export interface ObjectStorage {
  /** URL the browser PUTs the file to. The size and type are part of the signature. */
  presignUpload(input: { key: string; contentType: string; contentLength: number; expiresInSeconds?: number }): Promise<string>;
  /** URL valid 5 minutes by default, forcing a download under `filename` (spec, section 5). */
  presignDownload(input: { key: string; filename: string; expiresInSeconds?: number }): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  /** The first `bytes` bytes of the object. */
  readHead(key: string, bytes: number): Promise<Uint8Array>;
  /** SHA-256 of the whole object, computed while streaming it. */
  sha256(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export const UPLOAD_URL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_SECONDS = 5 * 60;

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

const isNotFound = (error: unknown) => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
};

export function createS3Storage(config: S3Config): ObjectStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    // MinIO and most S3-compatible providers expect path-style addressing.
    forcePathStyle: true,
    // The SDK adds optional checksums by default; providers that predate them reject them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.bucket;

  return {
    presignUpload: ({ key, contentType, contentLength, expiresInSeconds = UPLOAD_URL_SECONDS }) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: contentLength }), {
        expiresIn: expiresInSeconds,
        // Sign the length and the type: the browser cannot send a bigger or different file.
        signableHeaders: new Set(["content-type", "content-length"]),
      }),

    presignDownload: ({ key, filename, expiresInSeconds = DOWNLOAD_URL_SECONDS }) =>
      getSignedUrl(
        client,
        new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: attachmentDisposition(filename) }),
        { expiresIn: expiresInSeconds },
      ),

    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: result.ContentLength ?? 0 };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async readHead(key, bytes) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${Math.max(0, bytes - 1)}` }));
      return result.Body ? await result.Body.transformToByteArray() : new Uint8Array();
    },

    async sha256(key) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      const hash = createHash("sha256");
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) hash.update(chunk);
      return hash.digest("hex");
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

let storage: ObjectStorage | undefined;

export interface S3Env {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
}

/** Storage configured from the environment (one client per process). */
export function getStorage(env: S3Env): ObjectStorage {
  storage ??= createS3Storage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
  });
  return storage;
}
