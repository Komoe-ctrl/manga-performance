import { getEnv } from "@manga/core/env";
import { getPrisma } from "../db";
import { getEnqueuer } from "../queue";
import { getStorage } from "../storage/object-storage";
import { createEntityService } from "./entity-service";
import { createPlanService } from "./plan-service";
import { createCollectionReadService } from "./read-service";
import { createSubmissionService } from "./submission-service";

/** Services du module Collecte, branchés sur la base, le stockage privé et la file de jobs. */
export function getCollection() {
  const env = getEnv();
  const prisma = getPrisma();
  const queue = { enqueueParseSubmission: async (...args: Parameters<Awaited<ReturnType<typeof getEnqueuer>>["enqueueParseSubmission"]>) => (await getEnqueuer()).enqueueParseSubmission(...args) };
  return {
    read: createCollectionReadService({ prisma }),
    entities: createEntityService({ prisma }),
    plans: createPlanService({ prisma }),
    submissions: createSubmissionService({ prisma, storage: getStorage(env), queue }),
  };
}
