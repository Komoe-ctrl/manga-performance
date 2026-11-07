import { getEnv } from "@manga/core/env";
import { getPrisma } from "../db";
import { getStorage } from "../storage/object-storage";
import { createPrivacyService, type PrivacyService } from "./privacy-service";

export function getPrivacy(): PrivacyService {
  return createPrivacyService({ prisma: getPrisma(), storage: getStorage(getEnv()) });
}
