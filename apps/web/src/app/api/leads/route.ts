import { getEnv } from "@manga/core/env";
import { getCrm } from "@/server/crm/instance";
import { getConsultantNotifier } from "@/server/email/consultant-notifier";
import { handleLeadRequest } from "@/server/leads/handle-lead";

/** Public endpoint: contact form, chatbot and demo leads. */
export async function POST(request: Request) {
  const env = getEnv();
  return handleLeadRequest(request, {
    crm: getCrm(),
    notifier: getConsultantNotifier(),
    env,
  });
}
