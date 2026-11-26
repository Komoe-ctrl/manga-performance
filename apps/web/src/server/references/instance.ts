import { revalidatePath } from "next/cache";
import { getEnv } from "@manga/core/env";
import { getPrisma } from "../db";
import { getStorage } from "../storage/object-storage";
import { createReferencesService, type ReferencesService } from "./references-service";

export function getReferences(): ReferencesService {
  const env = getEnv();
  return createReferencesService({
    prisma: getPrisma(),
    storage: getStorage(env),
    publicBaseUrl: env.S3_PUBLIC_URL ?? `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}`,
    revalidate: (paths) => paths.forEach((path) => revalidatePath(path)),
  });
}
