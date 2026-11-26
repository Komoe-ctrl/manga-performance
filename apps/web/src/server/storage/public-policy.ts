import { PutBucketPolicyCommand, type S3Client } from "@aws-sdk/client-s3";
import { PUBLIC_BLOG_PREFIX, PUBLIC_REFERENCES_PREFIX } from "@manga/core/files";

/**
 * Makes `public/blog/*` (article covers) and `public/references/*` (client logos) readable by anyone and
 * nothing else: the bucket stays private. Read-only (`s3:GetObject`) on those two prefixes; no listing, no writes.
 */
export function publicBlogPolicy(bucket: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PublicReadSiteImages",
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/${PUBLIC_BLOG_PREFIX}*`, `arn:aws:s3:::${bucket}/${PUBLIC_REFERENCES_PREFIX}*`],
      },
    ],
  });
}

export async function applyPublicBlogPolicy(client: S3Client, bucket: string): Promise<void> {
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: publicBlogPolicy(bucket) }));
}
