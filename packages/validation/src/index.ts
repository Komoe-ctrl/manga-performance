import { z } from "zod";

const email = z.email().max(254).transform((value) => value.trim().toLowerCase());
const password = z.string().min(1).max(256);
const token = z.string().min(20).max(200);

export const inviteClientSchema = z.object({
  clientId: z.string().min(1).max(64),
  email,
  name: z.string().trim().min(1).max(120),
});

export const acceptInvitationSchema = z.object({ token, password });

export const requestPasswordResetSchema = z.object({ email });

export const resetPasswordSchema = z.object({ token, password });

export type InviteClientInput = z.infer<typeof inviteClientSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ---------------------------------------------------------------------------
// CRM. Values use the front's lowercase vocabulary; the server maps them to the
// database enums (see apps/web/src/server/crm/mappers.ts).
// ---------------------------------------------------------------------------

export const prospectStatuses = ["nouveau", "en_negociation", "client", "perdu"] as const;
export const prospectSources = [
  "site_formulaire",
  "chatbot",
  "scraper",
  "newsletter",
  "manuel",
  "recommandation",
] as const;
export const companySizes = ["tpe", "pme", "grande_entreprise"] as const;
export const needs = [
  "business_plan",
  "tableau_de_bord",
  "tresorerie",
  "maitrise_couts",
  "audit",
  "autre",
] as const;
export const interactionTypes = ["email", "appel", "reunion", "note"] as const;
export const followUpRules = ["J+7", "J+15", "J+30", "manuel"] as const;

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const createProspectSchema = z.object({
  companyName: text(200).min(1),
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.email().optional()),
  phone: optionalText(40),
  sector: text(80).min(1),
  city: optionalText(80),
  size: z.enum(companySizes).optional(),
  need: z.enum(needs).optional(),
  status: z.enum(prospectStatuses).optional(),
  source: z.enum(prospectSources).default("manuel"),
  estimatedValue: z.number().int().min(0).max(10_000_000_000).optional(),
  ownerNote: optionalText(5000),
});

export const updateProspectStatusSchema = z.object({
  id,
  status: z.enum(prospectStatuses),
  createAccess: z.boolean().optional(),
});

export const addInteractionSchema = z.object({
  prospectId: id,
  type: z.enum(interactionTypes),
  summary: text(5000).min(1),
  date: z.iso.datetime({ offset: true }),
});

export const addFollowUpSchema = z.object({
  prospectId: id,
  dueAt: z.iso.datetime({ offset: true }),
  rule: z.enum(followUpRules).default("manuel"),
});

export const settingsSchema = z.object({
  cabinetName: text(120).min(1),
  address: text(300),
  phone: text(40),
  email: text(254),
  logoName: text(200),
  followUps: z.object({ j7: z.boolean(), j15: z.boolean(), j30: z.boolean() }),
  vatPercent: z.number().min(0).max(100),
  invoiceMentions: text(5000),
  bankDetails: text(2000),
  whatsappNumber: text(40),
  whatsappMessage: text(500),
});

export type CreateProspectInput = z.input<typeof createProspectSchema>;
export type Settings = z.infer<typeof settingsSchema>;

// ---------------------------------------------------------------------------
// Public leads (POST /api/leads). Strict: unknown fields are rejected.
// ---------------------------------------------------------------------------

export const leadSources = ["site_formulaire", "chatbot", "demo"] as const;
export type LeadSource = (typeof leadSources)[number];

export const leadSchema = z
  .strictObject({
    source: z.enum(leadSources),
    name: text(120).min(2),
    email: z
      .string()
      .trim()
      .max(254)
      .optional()
      .transform((value) => (value ? value.toLowerCase() : undefined))
      .pipe(z.email().optional()),
    phone: optionalText(40),
    company: optionalText(200),
    sector: optionalText(80),
    need: z.enum(needs).optional(),
    message: optionalText(5000),
    /** Consent to the processing of personal data: required, and recorded with its source. */
    consent: z.literal(true),
    /** Cloudflare Turnstile response token, verified server-side. */
    turnstileToken: z.string().max(2048).optional(),
    /** Honeypot: real visitors never fill it. */
    website: z.string().max(200).optional(),
  })
  .superRefine((lead, ctx) => {
    // The chatbot only sends a lead with a way to reach the person (spec, 6.1).
    if (lead.source === "chatbot" && !lead.email && !lead.phone) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Email ou téléphone requis" });
    }
    if (lead.source !== "chatbot" && !lead.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Email requis" });
    }
  });

export type LeadInput = z.input<typeof leadSchema>;
export type LeadData = z.output<typeof leadSchema>;

// ---------------------------------------------------------------------------
// Billing. Same vocabulary as the front: client id = prospect id, VAT as a fraction,
// decimal quantities. The server converts to hundredths and basis points.
// ---------------------------------------------------------------------------

export const paymentMethods = ["VIREMENT", "CHEQUE", "ESPECES", "MOBILE_MONEY", "AUTRE"] as const;

const invoiceLineInput = z.object({
  label: text(300).min(1),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: z.number().int().min(-2_000_000_000).max(2_000_000_000),
});

export const createInvoiceInputSchema = z.object({
  clientId: id,
  lines: z.array(invoiceLineInput).max(100),
  vatRate: z.number().min(0).max(1),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  /** `emise` issues the invoice right away; `brouillon` only saves a draft. */
  status: z.enum(["brouillon", "emise"]),
  fneNumber: optionalText(60),
});

export const updateInvoicePatchSchema = z.object({
  fneNumber: z.string().trim().max(60).optional(),
  status: z.literal("payee").optional(),
});

export const recordPaymentSchema = z.object({
  id,
  amount: z.number().int().positive().max(2_000_000_000),
  method: z.enum(paymentMethods),
  paidAt: z.iso.datetime({ offset: true }),
  reference: optionalText(120),
});

export const cancelInvoiceSchema = z.object({ id, reason: text(500).min(1) });

export type CreateInvoiceInput = z.input<typeof createInvoiceInputSchema>;

// ---------------------------------------------------------------------------
// Client space: uploads, deliverables, messages, notifications.
// ---------------------------------------------------------------------------

export const uploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().max(150),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
});

/** `key` comes from a previous upload request; the server re-checks it belongs to the client. */
const attachmentSchema = z.object({ key: z.string().min(1).max(300), filename: z.string().trim().min(1).max(255) });

export const publishDeliverableSchema = z.object({
  clientId: id,
  title: z.string().trim().min(1).max(200),
  key: z.string().min(1).max(300),
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachment: attachmentSchema.optional(),
});

export const sendAdminMessageSchema = sendMessageSchema.extend({ clientId: id });

export const notificationsQuerySchema = z.object({
  unreadOnly: z.boolean().optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
