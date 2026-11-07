import { getAccountFlows } from "../auth/flows-instance";
import { getPrisma } from "../db";
import { createCrmService, type CrmService } from "./crm-service";

/** CRM service wired to the real database and account flows. */
export function getCrm(): CrmService {
  return createCrmService({ prisma: getPrisma(), flows: getAccountFlows() });
}
