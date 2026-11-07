import { z } from "zod";

/** Queue names (spec, section 7). */
export const QUEUES = {
  emailSend: "email.send",
  notificationsFanout: "notifications.fanout",
  followupsDailyDigest: "followups.daily-digest",
  invoicesMarkOverdue: "invoices.mark-overdue",
  invoicesPaymentReminders: "invoices.payment-reminders",
  sequencesDispatch: "sequences.dispatch",
  newsletterPurgeUnconfirmed: "newsletter.purge-unconfirmed",
} as const;

const url = z.url({ protocol: /^https?$/ });
const text = (max: number) => z.string().max(max);
const isoDate = z.iso.datetime({ offset: true });

/**
 * One schema per template: the data a job must carry. Jobs are validated again by the
 * worker, so a malformed payload can never produce a half-empty email.
 */
export const templateSchemas = {
  invitation: z.object({ name: text(120), url, expiresAt: isoDate }),
  "password-reset": z.object({ name: text(120), url }),
  "newsletter-confirmation": z.object({ url }),
  "new-deliverable": z.object({ name: text(120), title: text(200), url }),
  // Deliberately no message content: the email only points to the client space (spec, 6.5).
  "new-message": z.object({ name: text(120), url }),
  "payment-reminder": z.object({
    name: text(120),
    invoiceNumber: text(40),
    /** Remaining amount, in FCFA. */
    amountDue: z.number().int().min(0),
    dueAt: isoDate,
    url,
  }),
  "new-lead": z.object({
    contactName: text(120),
    companyName: text(200),
    sourceLabel: text(80),
    returning: z.boolean(),
    url,
  }),
  // Personalised, already sanitized body (spec, 6.7). Sent from the marketing address, with List-Unsubscribe.
  marketing: z.object({
    subject: text(200),
    bodyHtml: text(200_000),
    unsubscribeUrl: url,
    /** Open-tracking pixel (signed URL). */
    pixelUrl: url.optional(),
  }),
  "daily-digest": z.object({
    /** Calendar day in the display timezone, `YYYY-MM-DD`. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    overdue: z.array(
      z.object({ company: text(200), rule: text(20), dueAt: isoDate, url }),
    ),
    today: z.array(z.object({ company: text(200), rule: text(20), dueAt: isoDate, url })),
    adminUrl: url,
  }),
} as const;

export type TemplateName = keyof typeof templateSchemas;
export type TemplateData<T extends TemplateName> = z.infer<(typeof templateSchemas)[T]>;

const address = z.email().max(254);

const job = <T extends TemplateName>(template: T) =>
  z.object({ template: z.literal(template), to: address, data: templateSchemas[template] });

/** Payload of the `email.send` queue. */
export const emailJobSchema = z.discriminatedUnion("template", [
  job("invitation"),
  job("password-reset"),
  job("newsletter-confirmation"),
  job("new-deliverable"),
  job("new-message"),
  job("payment-reminder"),
  job("new-lead"),
  job("daily-digest"),
  // A marketing email also carries the enrolment it belongs to, for tracking and stop rules.
  z.object({
    template: z.literal("marketing"),
    to: address,
    data: templateSchemas.marketing,
    enrollmentId: z.string().min(1).max(64).optional(),
  }),
]);

/** Templates sent from the marketing address and subject to the suppression list. */
export const MARKETING_TEMPLATES: readonly TemplateName[] = ["marketing"];
export const isMarketingTemplate = (template: TemplateName): boolean => MARKETING_TEMPLATES.includes(template);

export type EmailJob = z.infer<typeof emailJobSchema>;

/** Payload of the `notifications.fanout` queue: in-app notifications, and optionally an email. */
export const fanoutJobSchema = z.object({
  /** NEW_LEAD | NEW_DELIVERABLE | NEW_MESSAGE | FOLLOW_UP_DUE | … */
  type: z.string().min(1).max(60),
  audience: z.union([z.literal("ADMINS"), z.object({ userId: z.string().min(1) })]),
  payload: z.record(z.string(), z.unknown()),
  /** Email sent with the notification (not user-specific: sent once). */
  email: emailJobSchema.optional(),
});

export type FanoutJob = z.infer<typeof fanoutJobSchema>;

/** Payload of the scheduled `followups.daily-digest` job. */
export const dailyDigestJobSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export type DailyDigestJob = z.infer<typeof dailyDigestJobSchema>;
