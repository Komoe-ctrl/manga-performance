import { hasMalformedVariable, unknownVariables } from "@manga/core";
import { textToTiptap, tiptapToText } from "@manga/core/rich-text";
import { isSuppressed } from "@manga/db/marketing";
import type { Prisma, PrismaClient } from "@manga/db";
import { marketingSettingsSchema, type SequenceInput } from "@manga/validation";
import type { EmailSequence } from "@/lib/types";
import { DomainError } from "../domain-error";
import { recordAudit } from "../repositories/audit";

export type SequenceErrorCode = "NOT_FOUND" | "INVALID" | "CANNOT_ENROLL" | "ALREADY_ENROLLED";

export class SequenceError extends DomainError {
  constructor(code: SequenceErrorCode, message: string) {
    super(code, message);
    this.name = "SequenceError";
  }
}

const TRIGGER_TO_DB = { inscription_newsletter: "NEWSLETTER_SIGNUP", manuel: "MANUAL" } as const;
const TRIGGER_TO_FRONT = { NEWSLETTER_SIGNUP: "inscription_newsletter", MANUAL: "manuel" } as const;

export interface SequencesDeps {
  prisma: PrismaClient;
  now?: () => Date;
}

const stepsInclude = { steps: { orderBy: { order: "asc" } } } satisfies Prisma.EmailSequenceInclude;

/**
 * Email sequences (spec, 6.7): definition, validation, enrolment and statistics. Sending
 * itself is the worker's `sequences.dispatch` job.
 */
export function createSequencesService({ prisma, now = () => new Date() }: SequencesDeps) {
  /** Unknown variables are refused at save time, and so is any unfinished `{{`. */
  function validate(input: SequenceInput) {
    for (const step of input.steps) {
      for (const [label, text] of [["l'objet", step.subject], ["le contenu", step.body]] as const) {
        const unknown = unknownVariables(text);
        if (unknown.length > 0) {
          throw new SequenceError("INVALID", `Variable inconnue dans ${label} de l'étape ${step.order} : {{${unknown[0]}}}. Variables autorisées : {{prenom}}, {{entreprise}}, {{secteur}}, {{besoin}}.`);
        }
        if (hasMalformedVariable(text)) {
          throw new SequenceError("INVALID", `Variable mal formée dans ${label} de l'étape ${step.order} (accolades non fermées).`);
        }
      }
    }
  }

  async function stats(sequenceId: string): Promise<EmailSequence["stats"]> {
    const ids = (await prisma.sequenceEnrollment.findMany({ where: { sequenceId }, select: { id: true } })).map((e) => e.id);
    const unsubscribed = await prisma.sequenceEnrollment.count({ where: { sequenceId, status: "UNSUBSCRIBED" } });
    if (ids.length === 0) return { enrolled: 0, sent: 0, opened: 0, clicked: 0, unsubscribed };

    const of = (type: string) => ({ type, enrollmentId: { in: ids } });
    const [sent, opened, clicked] = await Promise.all([
      prisma.emailEvent.count({ where: of("SENT") }),
      // People, not events: several opens by one person count once.
      prisma.emailEvent.findMany({ where: of("OPENED"), distinct: ["enrollmentId"], select: { id: true } }),
      prisma.emailEvent.findMany({ where: of("CLICKED"), distinct: ["enrollmentId"], select: { id: true } }),
    ]);
    return { enrolled: ids.length, sent, opened: opened.length, clicked: clicked.length, unsubscribed };
  }

  async function toFront(row: Prisma.EmailSequenceGetPayload<{ include: typeof stepsInclude }>): Promise<EmailSequence> {
    return {
      id: row.id,
      name: row.name,
      trigger: TRIGGER_TO_FRONT[row.trigger as keyof typeof TRIGGER_TO_FRONT] ?? "manuel",
      active: row.active,
      steps: row.steps.map((step) => ({ order: step.order, delayDays: step.delayDays, subject: step.subject, body: tiptapToText(step.bodyJson) })),
      stats: await stats(row.id),
    };
  }

  const stepRows = (sequenceId: string, steps: SequenceInput["steps"]) =>
    [...steps]
      .sort((a, b) => a.order - b.order)
      // Orders are renumbered 1..n so the dispatcher can rely on them.
      .map((step, index) => ({ sequenceId, order: index + 1, delayDays: step.delayDays, subject: step.subject.trim(), bodyJson: textToTiptap(step.body) as unknown as Prisma.InputJsonValue }));

  return {
    async list(): Promise<EmailSequence[]> {
      const rows = await prisma.emailSequence.findMany({ include: stepsInclude, orderBy: { name: "asc" } });
      return Promise.all(rows.map(toFront));
    },

    async get(id: string): Promise<EmailSequence | null> {
      const row = await prisma.emailSequence.findUnique({ where: { id }, include: stepsInclude });
      return row ? toFront(row) : null;
    },

    /** A new sequence starts inactive with one empty step, as in the screens. */
    async create(name: string, actorId: string): Promise<EmailSequence> {
      const clean = name.trim();
      if (!clean || clean.length > 120) throw new SequenceError("INVALID", "Donnez un nom à la séquence (120 caractères maximum).");
      const row = await prisma.emailSequence.create({
        data: { name: clean, trigger: "MANUAL", active: false, steps: { create: { order: 1, delayDays: 0, subject: "", bodyJson: textToTiptap("") as unknown as Prisma.InputJsonValue } } },
        include: stepsInclude,
      });
      await recordAudit(prisma, { actorId, action: "sequence.created", entity: "EmailSequence", entityId: row.id });
      return toFront(row);
    },

    async update(id: string, input: SequenceInput, actorId: string): Promise<EmailSequence> {
      validate(input);
      if (input.active && input.steps.some((step) => !step.subject.trim() || !step.body.trim())) {
        throw new SequenceError("INVALID", "Chaque étape doit avoir un objet et un contenu avant d'activer la séquence.");
      }
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.emailSequence.findUnique({ where: { id } });
        if (!existing) throw new SequenceError("NOT_FOUND", "Séquence introuvable.");
        await tx.emailSequence.update({ where: { id }, data: { name: input.name.trim(), trigger: TRIGGER_TO_DB[input.trigger], active: input.active } });
        await tx.sequenceStep.deleteMany({ where: { sequenceId: id } });
        await tx.sequenceStep.createMany({ data: stepRows(id, input.steps) });
        await recordAudit(tx, { actorId, action: "sequence.updated", entity: "EmailSequence", entityId: id, diff: { active: input.active } });
        return tx.emailSequence.findUniqueOrThrow({ where: { id }, include: stepsInclude });
      });
      return toFront(row);
    },

    /**
     * Enrols a prospect (manual action, or the newsletter confirmation). Refused for clients,
     * lost prospects, addresses on the suppression list, and prospects without an email.
     */
    async enroll(sequenceId: string, prospectId: string, actorId: string | null): Promise<{ enrollmentId: string }> {
      const sequence = await prisma.emailSequence.findUnique({ where: { id: sequenceId }, include: { steps: { orderBy: { order: "asc" }, take: 1 } } });
      if (!sequence) throw new SequenceError("NOT_FOUND", "Séquence introuvable.");
      const first = sequence.steps[0];
      if (!first) throw new SequenceError("INVALID", "La séquence n'a aucune étape.");

      const prospect = await prisma.prospect.findFirst({ where: { id: prospectId, deletedAt: null } });
      if (!prospect) throw new SequenceError("NOT_FOUND", "Prospect introuvable.");
      if (prospect.status === "CLIENT" || prospect.status === "PERDU") throw new SequenceError("CANNOT_ENROLL", "Ce prospect est déjà client ou perdu : aucun email marketing.");
      if (!prospect.email) throw new SequenceError("CANNOT_ENROLL", "Ce prospect n'a pas d'adresse email.");
      if (await isSuppressed(prisma, prospect.email)) throw new SequenceError("CANNOT_ENROLL", "Cette adresse est sur la liste d'exclusion : aucun email marketing.");

      const existing = await prisma.sequenceEnrollment.findUnique({ where: { sequenceId_prospectId: { sequenceId, prospectId } } });
      if (existing) throw new SequenceError("ALREADY_ENROLLED", "Ce prospect a déjà été inscrit à cette séquence.");

      const at = now();
      const enrollment = await prisma.sequenceEnrollment.create({
        data: { sequenceId, prospectId, status: "ACTIVE", currentStep: 0, nextSendAt: new Date(at.getTime() + first.delayDays * 86_400_000), enrolledAt: at },
      });
      await recordAudit(prisma, { actorId, action: "sequence.enrolled", entity: "SequenceEnrollment", entityId: enrollment.id, diff: { sequenceId, prospectId } });
      return { enrollmentId: enrollment.id };
    },

    /** Active sequences whose trigger is the newsletter confirmation. */
    async enrollNewsletterSignup(prospectId: string): Promise<number> {
      const sequences = await prisma.emailSequence.findMany({ where: { active: true, trigger: "NEWSLETTER_SIGNUP" }, select: { id: true } });
      let enrolled = 0;
      for (const sequence of sequences) {
        try {
          await this.enroll(sequence.id, prospectId, null);
          enrolled++;
        } catch (error) {
          if (!(error instanceof SequenceError)) throw error;
          // Not eligible (client, suppressed, already enrolled): nothing to do.
        }
      }
      return enrolled;
    },

    async getMarketingSettings() {
      const row = await prisma.setting.findUnique({ where: { key: "marketing" } });
      const parsed = marketingSettingsSchema.safeParse(row?.value);
      return parsed.success ? parsed.data : { dailyCap: 50 };
    },

    async saveMarketingSettings(input: unknown, actorId: string) {
      const parsed = marketingSettingsSchema.safeParse(input);
      if (!parsed.success) throw new SequenceError("INVALID", "Le plafond quotidien doit être un nombre entier positif.");
      const value = parsed.data;
      await prisma.setting.upsert({ where: { key: "marketing" }, create: { key: "marketing", value }, update: { value } });
      await recordAudit(prisma, { actorId, action: "settings.marketing_updated", entity: "Setting", entityId: "marketing", diff: value });
      return value;
    },
  };
}

export type SequencesService = ReturnType<typeof createSequencesService>;
