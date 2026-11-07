// One-off setup of the storage bucket: public read access to `public/blog/*` only.
// Run with `pnpm storage:setup` (reads the repository .env). Safe to repeat.
import { resolve } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { applyPublicBlogPolicy } from "../src/server/storage/public-policy";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file: variables come from the real environment.
}

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
if (!S3_ENDPOINT || !S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  throw new Error("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are required.");
}

const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});
await applyPublicBlogPolicy(client, S3_BUCKET);
console.log(`Bucket "${S3_BUCKET}": public read access on public/blog/* only.`);
