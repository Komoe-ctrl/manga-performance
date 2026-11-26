import { getEnv } from "@manga/core/env";
import { getPrisma } from "../db";
import { getEnqueuer } from "../queue";
import { getStorage } from "../storage/object-storage";
import { createCpraService } from "./cpra-service";
import { createEntityService } from "./entity-service";
import { createHotelKpiService } from "./hotel-kpi-service";
import { createPlanService } from "./plan-service";
import { createCollectionReadService } from "./read-service";
import { createSubmissionService } from "./submission-service";

/** Services du module Collecte, branchés sur la base, le stockage privé et la file de jobs. */
export function getCollection() {
  const env = getEnv();
  const prisma = getPrisma();
  const queue = {
    enqueueParseSubmission: async (...args: Parameters<Awaited<ReturnType<typeof getEnqueuer>>["enqueueParseSubmission"]>) => (await getEnqueuer()).enqueueParseSubmission(...args),
    enqueueHotelCompute: async (...args: Parameters<Awaited<ReturnType<typeof getEnqueuer>>["enqueueHotelCompute"]>) => (await getEnqueuer()).enqueueHotelCompute(...args),
    enqueueEmail: async (...args: Parameters<Awaited<ReturnType<typeof getEnqueuer>>["enqueueEmail"]>) => (await getEnqueuer()).enqueueEmail(...args),
  };
  return {
    read: createCollectionReadService({ prisma }),
    entities: createEntityService({ prisma }),
    plans: createPlanService({ prisma }),
    cpra: createCpraService({ prisma }),
    hotelKpis: createHotelKpiService({ prisma, queue, notification: { to: env.ADMIN_NOTIFICATION_EMAIL, appUrl: env.APP_URL } }),
    submissions: createSubmissionService({ prisma, storage: getStorage(env), queue }),
  };
}
