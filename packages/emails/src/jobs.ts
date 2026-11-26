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
  collectionParseSubmission: "collection.parse-submission",
  collectionOpenPeriods: "collection.open-periods",
  collectionMarkLate: "collection.mark-late",
  collectionReminders: "collection.reminders",
  collectionWeeklyDigest: "collection.weekly-digest",
  hotelCompute: "hotel.compute",
} as const;

/** Payload of `collection.parse-submission`: the submission is read from the database, never from the job. */
/** Payload of `hotel.compute`: the accepted deposit of the period is read from the database. */
export interface HotelComputeJob {
  periodId: string;
}

export interface ParseSubmissionJob {
  submissionId: string;
}

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
  // Collecte de données (avenant n°1, §6 et §7).
  "collection-reminder": z.object({
    name: text(120),
    entityName: text(200),
    /** Libellé du modèle de collecte. */
    templateLabel: text(120),
    periodLabel: text(60),
    dueAt: isoDate,
    /** Écart à l échéance : négatif avant, positif après. */
    offset: z.number().int(),
    /** La direction du client est en copie (escalade). */
    escalation: z.boolean(),
    url,
  }),
  "collection-rejected": z.object({
    name: text(120),
    entityName: text(200),
    periodLabel: text(60),
    errorCount: z.number().int().min(0),
    /** Les premiers messages d'erreur, pour que le déposant sache quoi corriger. */
    firstErrors: z.array(text(300)).max(10),
    url,
  }),
  "collection-repeated-rejection": z.object({
    clientName: text(200),
    entityName: text(200),
    periodLabel: text(60),
    rejections: z.number().int().min(1),
    adminUrl: url,
  }),
  "collection-weekly-digest": z.object({
    /** Lundi de la semaine récapitulée, `YYYY-MM-DD`. */
    weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expected: z.number().int().min(0),
    received: z.number().int().min(0),
    late: z.array(z.object({ client: text(200), entity: text(200), period: text(60), daysLate: z.number().int().min(0) })).max(100),
    rejected: z.array(z.object({ client: text(200), entity: text(200), period: text(60) })).max(100),
    adminUrl: url,
  }),
  /** Alertes KPI hôtelier : consultant seulement, jamais le client (avenant §11 bis). */
  "hotel-kpi-alert": z.object({
    entityName: text(200),
    clientName: text(200),
    periodLabel: text(60),
    alerts: z.array(z.object({ code: text(40), level: text(20), message: text(300) })).min(1).max(20),
    /** Les indicateurs peuvent être absents (division par zéro) : l'email affiche alors « — ». */
    revpar: z.number().nullable(),
    trevpar: z.number().nullable(),
    gop: z.number(),
    goppar: z.number().nullable(),
    gopMarginPct: z.number().nullable(),
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
  job("collection-reminder"),
  job("collection-rejected"),
  job("collection-repeated-rejection"),
  job("collection-weekly-digest"),
  job("hotel-kpi-alert"),
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
