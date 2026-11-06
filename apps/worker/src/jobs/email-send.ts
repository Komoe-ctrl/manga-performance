import { PermanentEmailError, emailJobSchema, renderEmail } from "@manga/emails";
import { loadCabinet } from "../cabinet";
import type { WorkerDeps } from "../deps";

/**
 * `email.send`: validates, renders and sends one email. A transient failure throws, so
 * pg-boss retries (3 attempts, exponential backoff); a permanent one (bad key, bad
 * address) or a malformed payload is logged and dropped, since retrying cannot help.
 */
export async function handleEmailSend(payload: unknown, deps: WorkerDeps): Promise<void> {
  const parsed = emailJobSchema.safeParse(payload);
  if (!parsed.success) {
    deps.logger.error("email job dropped: invalid payload");
    return;
  }
  const job = parsed.data;
  const rendered = await renderEmail(job, await loadCabinet(deps.prisma));

  try {
    const { messageId } = await deps.provider.send({
      from: deps.env.EMAIL_FROM_TRANSACTIONAL,
      to: job.to,
      ...rendered,
    });
    deps.logger.info(
      { template: job.template, provider: deps.provider.name, to: job.to, messageId },
      "email sent",
    );
  } catch (error) {
    if (error instanceof PermanentEmailError) {
      deps.logger.error(
        { template: job.template, to: job.to, reason: error.message },
        "email rejected, not retrying",
      );
      return;
    }
    throw error;
  }
}
