import { PutBucketPolicyCommand, type S3Client } from "@aws-sdk/client-s3";
import { PUBLIC_BLOG_PREFIX } from "@manga/core/files";

/**
 * Makes `public/blog/*` readable by anyone and nothing else: the bucket stays private.
 * Read-only (`s3:GetObject`) on that single prefix; no listing, no writes.
 */
export function publicBlogPolicy(bucket: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PublicReadBlogCovers",
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/${PUBLIC_BLOG_PREFIX}*`],
      },
    ],
  });
}

export async function applyPublicBlogPolicy(client: S3Client, bucket: string): Promise<void> {
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: publicBlogPolicy(bucket) }));
}
