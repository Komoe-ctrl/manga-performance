import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectReader } from "./jobs/parse-submission";

/** Plafond de lecture : au-delà, le fichier n'est pas un dépôt de collecte valide (10 Mo à l'envoi). */
const MAX_READ_BYTES = 12 * 1024 * 1024;

export interface S3ReaderEnv {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
}

/** Lecteur du bucket privé, configuré comme celui de l'application web. */
export function createS3Reader(env: S3ReaderEnv): ObjectReader {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async read(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      if (!result.Body) throw new Error("EMPTY_BODY");
      if ((result.ContentLength ?? 0) > MAX_READ_BYTES) throw new Error("OBJECT_TOO_LARGE");
      return result.Body.transformToByteArray();
    },
  };
}
