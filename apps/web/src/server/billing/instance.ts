import { getPrisma } from "../db";
import { getEnqueuer } from "../queue";
import { getEnv } from "@manga/core/env";
import { createInvoiceService, type InvoiceService } from "./invoice-service";

/** Invoice service wired to the real database, job queue and application URL. */
export function getBilling(): InvoiceService {
  return createInvoiceService({
    prisma: getPrisma(),
    // The queue starts on first use, so building the service never touches pg-boss.
    queue: { enqueueEmail: async (job, options) => (await getEnqueuer()).enqueueEmail(job, options) },
    appUrl: getEnv().APP_URL,
  });
}
