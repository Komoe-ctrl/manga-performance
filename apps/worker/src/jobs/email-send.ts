import { isSuppressed } from "@manga/db/marketing";
import { PermanentEmailError, emailJobSchema, isMarketingTemplate, renderEmail } from "@manga/emails";
import { loadCabinet } from "../cabinet";
import type { WorkerDeps } from "../deps";

/**
 * `email.send`: validates, renders and sends one email. A transient failure throws, so
 * pg-boss retries (3 attempts, exponential backoff); a permanent one (bad key, bad
 * address) or a malformed payload is logged and dropped, since retrying cannot help.
 *
 * Marketing emails get extra guard-rails (spec, 6.7): the suppression list is checked
 * right before sending, they leave from the marketing address, and they carry the
 * one-click unsubscribe headers.
 */
export async function handleEmailSend(payload: unknown, deps: WorkerDeps): Promise<void> {
  const parsed = emailJobSchema.safeParse(payload);
  if (!parsed.success) {
    deps.logger.error("email job dropped: invalid payload");
    return;
  }
  const job = parsed.data;
  const marketing = isMarketingTemplate(job.template);

  if (marketing && (await isSuppressed(deps.prisma, job.to))) {
    deps.logger.info({ template: job.template, to: job.to }, "marketing email skipped: address is suppressed");
    return;
  }

  const rendered = await renderEmail(job, await loadCabinet(deps.prisma));
  const headers =
    job.template === "marketing"
      ? { "List-Unsubscribe": `<${job.data.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined;

  try {
    const { messageId } = await deps.provider.send({
      from: marketing ? deps.env.EMAIL_FROM_MARKETING : deps.env.EMAIL_FROM_TRANSACTIONAL,
      to: job.to,
      ...rendered,
      headers,
    });
    if (job.template === "marketing" && job.enrollmentId) {
      // Links the provider's id to the enrolment, so bounces and complaints find their way back.
      await deps.prisma.emailEvent.create({
        data: { messageId, enrollmentId: job.enrollmentId, email: job.to, type: "SENT", occurredAt: (deps.now ?? (() => new Date()))() },
      });
    }
    deps.logger.info({ template: job.template, provider: deps.provider.name, to: job.to, messageId }, "email sent");
  } catch (error) {
    if (error instanceof PermanentEmailError) {
      deps.logger.error({ template: job.template, to: job.to, reason: error.message }, "email rejected, not retrying");
      return;
    }
    throw error;
  }
}
