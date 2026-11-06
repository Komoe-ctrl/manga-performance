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
