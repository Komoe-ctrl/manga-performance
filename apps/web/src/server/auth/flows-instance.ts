import { getEnv } from "@manga/core/env";
import { getPrisma } from "../db";
import { getAuthMailer } from "../email/auth-mailer";
import { createAccountFlows, type AccountFlows } from "./account-flows";

/** Account flows wired to the real database, mailer and application URL. */
export function getAccountFlows(): AccountFlows {
  return createAccountFlows({
    prisma: getPrisma(),
    mailer: getAuthMailer(),
    appUrl: getEnv().APP_URL,
  });
}
