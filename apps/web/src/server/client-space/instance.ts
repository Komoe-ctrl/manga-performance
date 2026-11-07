import { getEnv } from "@manga/core/env";
import { getPrisma } from "../db";
import { getEnqueuer } from "../queue";
import { getStorage } from "../storage/object-storage";
import { createClientSpaceService, type ClientSpaceService } from "./client-space-service";

/** Client-space service wired to the real database, storage and job queue. */
export function getClientSpace(): ClientSpaceService {
  const env = getEnv();
  return createClientSpaceService({
    prisma: getPrisma(),
    storage: getStorage(env),
    queue: {
      enqueueEmail: async (job, options) => (await getEnqueuer()).enqueueEmail(job, options),
      enqueueFanout: async (job, options) => (await getEnqueuer()).enqueueFanout(job, options),
    },
    appUrl: env.APP_URL,
    adminEmail: env.ADMIN_NOTIFICATION_EMAIL,
  });
}
