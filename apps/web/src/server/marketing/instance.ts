import { revalidatePath } from "next/cache";
import { getEnv } from "@manga/core/env";
import { getPrisma } from "../db";
import { getCrm } from "../crm/instance";
import { getEnqueuer } from "../queue";
import { getStorage } from "../storage/object-storage";
import { createBlogService, type BlogService } from "./blog-service";
import { createNewsletterService, type NewsletterService } from "./newsletter-service";
import { createSequencesService, type SequencesService } from "./sequences-service";

const queue = {
  enqueueEmail: async (job: Parameters<Awaited<ReturnType<typeof getEnqueuer>>["enqueueEmail"]>[0], options?: { dedupeKey?: string }) =>
    (await getEnqueuer()).enqueueEmail(job, options),
};

export function getSequences(): SequencesService {
  return createSequencesService({ prisma: getPrisma() });
}

export function getNewsletter(): NewsletterService {
  return createNewsletterService({ prisma: getPrisma(), queue, crm: getCrm(), sequences: getSequences(), appUrl: getEnv().APP_URL });
}

export function getBlog(): BlogService {
  const env = getEnv();
  return createBlogService({
    prisma: getPrisma(),
    storage: getStorage(env),
    publicBaseUrl: env.S3_PUBLIC_URL ?? `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}`,
    revalidate: (paths) => paths.forEach((path) => revalidatePath(path)),
  });
}
