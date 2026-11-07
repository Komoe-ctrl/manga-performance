import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  closesProspect,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  planFollowUps,
  type DuplicateReason,
} from "@manga/core";
import type { Prisma, PrismaClient } from "@manga/db";
import type { settingsSchema, createProspectSchema } from "@manga/validation";
import type { z } from "zod";
import type { Prospect, FollowUp, Interaction } from "@/lib/types";
import type { AccountFlows } from "../auth/account-flows";
import { recordAudit } from "../repositories/audit";
import { createSettingsRepository } from "../repositories/settings";
import { createUsersRepository } from "../repositories/users";
import { CrmError } from "./errors";
import {
  toDbInteractionType,
  toDbNeed,
  toDbSize,
  toDbSource,
  toDbStatus,
  toFrontFollowUp,
  toFrontInteraction,
  toFrontProspect,
} from "./mappers";

export type CreateProspectData = z.input<typeof createProspectSchema>;
export type SettingsData = z.output<typeof settingsSchema>;

export interface IngestLead {
  source: "site_formulaire" | "chatbot" | "demo" | "newsletter";
  /** Human wording used in the interaction note: "le formulaire de contact"… */
  sourceLabel: string;
  /** Absent for a newsletter signup: only an email is known. */
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  sector?: string;
  need?: Parameters<typeof toDbNeed>[0];
  message?: string;
}

export interface IngestResult {
  prospectId: string;
  /** false when an existing prospect was found and only a note was added. */
  created: boolean;
  companyName: string;
  contactName: string;
}

export interface CrmDeps {
  prisma: PrismaClient;
  flows: Pick<AccountFlows, "inviteClientUser" | "resendInvitation">;
  now?: () => Date;
}

const DUPLICATE_MESSAGES: Record<DuplicateReason, string> = {
  EMAIL: "un prospect avec le même email",
  PHONE: "un prospect avec le même téléphone",
  NAME: "un prospect avec un nom d'entreprise très proche",
};

const nextFollowUpInclude = {
  followUps: {
    where: { doneAt: null, cancelledAt: null },
    orderBy: { dueAt: "asc" },
    take: 1,
    select: { dueAt: true },
  },
} satisfies Prisma.ProspectInclude;

/**
 * CRM business rules (spec, 6.2 and 6.3): prospects, interactions, follow-ups,
 * conversion to client, portal access. Every mutation that matters is audited.
 * Callers must have checked authorization (`requireAdmin`) before calling.
 */
export function createCrmService({ prisma, flows, now = () => new Date() }: CrmDeps) {
  const settings = createSettingsRepository(prisma);
  const users = createUsersRepository(prisma);

  async function findDuplicate(keys: {
    email?: string;
    phone?: string;
    companyNameNorm: string;
  }): Promise<{ id: string; reason: DuplicateReason } | null> {
    if (keys.email) {
      const hit = await prisma.prospect.findFirst({
        where: { deletedAt: null, email: keys.email },
        select: { id: true },
      });
      if (hit) return { id: hit.id, reason: "EMAIL" };
    }
    if (keys.phone) {
      const hit = await prisma.prospect.findFirst({
        where: { deletedAt: null, phone: keys.phone },
        select: { id: true },
      });
      if (hit) return { id: hit.id, reason: "PHONE" };
    }
    if (keys.companyNameNorm) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Prospect"
        WHERE "deletedAt" IS NULL
          AND similarity("companyNameNorm", ${keys.companyNameNorm}) > ${DUPLICATE_SIMILARITY_THRESHOLD}::real
        ORDER BY similarity("companyNameNorm", ${keys.companyNameNorm}) DESC
        LIMIT 1`;
      if (rows[0]) return { id: rows[0].id, reason: "NAME" };
    }
    return null;
  }

  /** Status transition shared by creation and status changes (runs inside a transaction). */
  async function applyStatus(
    tx: Prisma.TransactionClient,
    prospect: { id: string; companyName: string },
    from: string | null,
    to: ReturnType<typeof toDbStatus>,
    actorId: string,
  ): Promise<void> {
    const at = now();
    await tx.prospect.update({
      where: { id: prospect.id },
      data: { status: to, ...(to === "CLIENT" ? { convertedAt: at } : {}) },
    });

    // Whatever the new status, the consultant has taken over: marketing sequences stop.
    await tx.sequenceEnrollment.updateMany({
      where: { prospectId: prospect.id, status: "ACTIVE" },
      data: { status: "STOPPED", nextSendAt: null },
    });
    if (closesProspect(to)) {
      await tx.followUp.updateMany({
        where: { prospectId: prospect.id, doneAt: null, cancelledAt: null },
        data: { cancelledAt: at },
      });
    }

    if (to === "CLIENT") {
      const client = await tx.client.upsert({
        where: { prospectId: prospect.id },
        create: { prospectId: prospect.id, legalName: prospect.companyName },
        update: { deletedAt: null },
      });
      await recordAudit(tx, {
        actorId,
        action: "prospect.converted",
        entity: "Client",
        entityId: client.id,
        diff: { prospectId: prospect.id },
      });
    }

    await recordAudit(tx, {
      actorId,
      action: "prospect.status_changed",
      entity: "Prospect",
      entityId: prospect.id,
      diff: { from, to },
    });
  }

  async function grantAccess(prospectId: string, actorId: string): Promise<void> {
    const prospect = await prisma.prospect.findFirst({
      where: { id: prospectId, deletedAt: null, client: { is: { deletedAt: null } } },
      include: { client: { include: { portalUsers: true } } },
    });
    if (!prospect?.client) throw new CrmError("NOT_A_CLIENT", "Ce prospect n'est pas encore client.");
    if (!prospect.email) {
      throw new CrmError("NO_EMAIL", "Renseignez l'email du contact avant d'activer l'accès.");
    }

    const [existing] = prospect.client.portalUsers;
    if (existing) {
      if (existing.disabledAt) await users.setDisabled(existing.id, false);
      const record = await users.findById(existing.id);
      if (record && !record.hasPassword) await flows.resendInvitation(existing.id);
    } else {
      const result = await flows.inviteClientUser({
        clientId: prospect.client.id,
        email: prospect.email,
        name: prospect.contactName ?? prospect.companyName,
      });
      if (!result.ok) {
        throw new CrmError(
          "INVALID",
          result.code === "EMAIL_TAKEN"
            ? "Cet email est déjà utilisé par un autre compte."
            : "Impossible de créer l'accès client.",
        );
      }
    }
    await recordAudit(prisma, {
      actorId,
      action: "client.access.granted",
      entity: "Client",
      entityId: prospect.client.id,
    });
  }

  return {
    findDuplicate,

    async listProspects(): Promise<Prospect[]> {
      const rows = await prisma.prospect.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: nextFollowUpInclude,
      });
      return rows.map((row) => toFrontProspect(row, row.followUps[0]?.dueAt));
    },

    async getProspect(id: string): Promise<Prospect | null> {
      const row = await prisma.prospect.findFirst({
        where: { id, deletedAt: null },
        include: nextFollowUpInclude,
      });
      return row ? toFrontProspect(row, row.followUps[0]?.dueAt) : null;
    },

    async createProspect(input: CreateProspectData, actorId: string): Promise<Prospect> {
      const email = input.email ? normalizeEmail(input.email) : undefined;
      let phone: string | undefined;
      if (input.phone) {
        const normalized = normalizePhone(input.phone);
        if (!normalized) {
          throw new CrmError("INVALID", "Numéro de téléphone invalide (format ivoirien attendu).");
        }
        phone = normalized;
      }
      const companyNameNorm = normalizeCompanyName(input.companyName);

      const duplicate = await findDuplicate({ email, phone, companyNameNorm });
      if (duplicate) {
        throw new CrmError(
          "DUPLICATE",
          `Il existe déjà ${DUPLICATE_MESSAGES[duplicate.reason]}.`,
          { existingId: duplicate.id },
        );
      }

      const status = toDbStatus(input.status ?? "nouveau");
      const rules = (await settings.get()).followUps;
      const createdAt = now();

      const id = await prisma.$transaction(async (tx) => {
        const created = await tx.prospect.create({
          data: {
            companyName: input.companyName,
            companyNameNorm,
            contactName: input.contactName,
            email,
            phone,
            sector: input.sector,
            city: input.city,
            size: input.size ? toDbSize(input.size) : undefined,
            need: input.need ? toDbNeed(input.need) : undefined,
            source: toDbSource(input.source ?? "manuel"),
            estimatedValue: input.estimatedValue,
            notes: input.ownerNote,
            createdAt,
          },
        });
        await recordAudit(tx, {
          actorId,
          action: "prospect.created",
          entity: "Prospect",
          entityId: created.id,
          diff: { source: created.source },
        });
        if (status !== "NOUVEAU") {
          await applyStatus(tx, created, null, status, actorId);
        }
        if (!closesProspect(status)) {
          const plan = planFollowUps(createdAt, rules);
          if (plan.length > 0) {
            await tx.followUp.createMany({
              data: plan.map((step) => ({ prospectId: created.id, rule: step.rule, dueAt: step.dueAt })),
            });
          }
        }
        return created.id;
      });

      const prospect = await this.getProspect(id);
      if (!prospect) throw new CrmError("NOT_FOUND", "Prospect introuvable.");
      return prospect;
    },

    /**
     * Inbound lead from a public form, the chatbot or the demo (spec, 6.1). No admin involved.
     * An existing prospect (same email, same phone, or a very similar company name) is never
     * duplicated: a NOTE interaction records the new contact instead.
     */
    async ingestLead(lead: IngestLead): Promise<IngestResult> {
      const email = lead.email ? normalizeEmail(lead.email) : undefined;
      let phone: string | undefined;
      if (lead.phone) {
        const normalized = normalizePhone(lead.phone);
        if (!normalized) {
          throw new CrmError("INVALID", "Numéro de téléphone invalide (format ivoirien attendu).");
        }
        phone = normalized;
      }
      if (lead.source === "chatbot" && !email && !phone) {
        throw new CrmError("INVALID", "Un email ou un téléphone valide est requis.");
      }
      if (lead.source === "newsletter" && !email) {
        throw new CrmError("INVALID", "Un email est requis.");
      }

      // A newsletter subscriber has no company yet: the address identifies the prospect.
      const companyName = lead.company || lead.name || email!;
      const companyNameNorm = normalizeCompanyName(companyName);
      const at = now();
      const consentSource = `lead:${lead.source}`;

      const existing = await findDuplicate({ email, phone, companyNameNorm });
      if (existing) {
        const summary = [`Nouveau contact via ${lead.sourceLabel}.`, lead.message]
          .filter(Boolean)
          .join("\n")
          .slice(0, 5000);
        await prisma.$transaction(async (tx) => {
          await tx.interaction.create({
            data: { prospectId: existing.id, type: "NOTE", summary, occurredAt: at, createdBy: "system" },
          });
          // The person consented again: keep the first consent if there is one.
          await tx.prospect.updateMany({
            where: { id: existing.id, consentAt: null },
            data: { consentAt: at, consentSource },
          });
        });
        return { prospectId: existing.id, created: false, companyName, contactName: lead.name ?? "" };
      }

      const rules = (await settings.get()).followUps;
      const prospectId = await prisma.$transaction(async (tx) => {
        const created = await tx.prospect.create({
          data: {
            companyName,
            companyNameNorm,
            contactName: lead.name,
            email,
            phone,
            sector: lead.sector || "Non précisé",
            need: lead.need ? toDbNeed(lead.need) : undefined,
            source: lead.source.toUpperCase() as "SITE_FORMULAIRE" | "CHATBOT" | "DEMO" | "NEWSLETTER",
            notes: lead.message,
            consentAt: at,
            consentSource,
            createdAt: at,
          },
        });
        await recordAudit(tx, {
          actorId: null,
          action: "prospect.created",
          entity: "Prospect",
          entityId: created.id,
          diff: { source: lead.source },
        });
        const plan = planFollowUps(at, rules);
        if (plan.length > 0) {
          await tx.followUp.createMany({
            data: plan.map((step) => ({ prospectId: created.id, rule: step.rule, dueAt: step.dueAt })),
          });
        }
        return created.id;
      });
      return { prospectId, created: true, companyName, contactName: lead.name ?? "" };
    },

    /**
     * Changes the status. Converting to CLIENT is one transaction: client record,
     * `convertedAt`, follow-ups cancelled, marketing sequences stopped, audit.
     * `createAccess` additionally invites the contact to the client space (explicit action).
     */
    async updateProspectStatus(
      id: string,
      status: Parameters<typeof toDbStatus>[0],
      options: { createAccess?: boolean },
      actorId: string,
    ): Promise<Prospect> {
      const target = toDbStatus(status);
      const prospect = await prisma.prospect.findFirst({ where: { id, deletedAt: null } });
      if (!prospect) throw new CrmError("NOT_FOUND", "Prospect introuvable.");
      if (prospect.status === "CLIENT" && target !== "CLIENT") {
        throw new CrmError("CLIENT_LOCKED", "Un client ne peut pas repasser au statut prospect.");
      }
      const wantsAccess = target === "CLIENT" && options.createAccess === true;
      if (wantsAccess && !prospect.email) {
        throw new CrmError("NO_EMAIL", "Renseignez l'email du contact avant d'activer l'accès.");
      }

      if (prospect.status !== target) {
        await prisma.$transaction((tx) => applyStatus(tx, prospect, prospect.status, target, actorId));
      }
      if (wantsAccess) await grantAccess(id, actorId);

      const updated = await this.getProspect(id);
      if (!updated) throw new CrmError("NOT_FOUND", "Prospect introuvable.");
      return updated;
    },

    async listInteractions(prospectId: string): Promise<Interaction[]> {
      const rows = await prisma.interaction.findMany({
        where: { prospectId },
        orderBy: { occurredAt: "desc" },
      });
      return rows.map(toFrontInteraction);
    },

    async addInteraction(
      input: { prospectId: string; type: Interaction["type"]; summary: string; date: string },
      actorId: string,
    ): Promise<Interaction> {
      const exists = await prisma.prospect.findFirst({
        where: { id: input.prospectId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) throw new CrmError("NOT_FOUND", "Prospect introuvable.");
      const row = await prisma.interaction.create({
        data: {
          prospectId: input.prospectId,
          type: toDbInteractionType(input.type),
          summary: input.summary,
          occurredAt: new Date(input.date),
          createdBy: actorId,
        },
      });
      return toFrontInteraction(row);
    },

    /** Pending and done follow-ups; cancelled ones (closed prospects) are not shown. */
    async listFollowUps(): Promise<FollowUp[]> {
      const rows = await prisma.followUp.findMany({
        where: { cancelledAt: null, prospect: { deletedAt: null } },
        orderBy: { dueAt: "asc" },
      });
      return rows.map(toFrontFollowUp);
    },

    async addFollowUp(
      input: { prospectId: string; dueAt: string; rule: FollowUp["rule"] },
    ): Promise<FollowUp> {
      const exists = await prisma.prospect.findFirst({
        where: { id: input.prospectId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) throw new CrmError("NOT_FOUND", "Prospect introuvable.");
      const row = await prisma.followUp.create({
        data: {
          prospectId: input.prospectId,
          dueAt: new Date(input.dueAt),
          rule: input.rule === "manuel" ? "MANUEL" : input.rule,
        },
      });
      return toFrontFollowUp(row);
    },

    async completeFollowUp(id: string): Promise<FollowUp | null> {
      const existing = await prisma.followUp.findUnique({ where: { id } });
      if (!existing) return null;
      const row = await prisma.followUp.update({
        where: { id },
        data: { doneAt: existing.doneAt ?? now() },
      });
      return toFrontFollowUp(row);
    },

    /** Clients = prospects converted to CLIENT. `id` stays the prospect id, as in the front. */
    async listClients() {
      const rows = await prisma.prospect.findMany({
        where: { deletedAt: null, status: "CLIENT", client: { is: { deletedAt: null } } },
        orderBy: { createdAt: "desc" },
        include: {
          client: {
            select: {
              portalUsers: { select: { disabledAt: true } },
              _count: { select: { deliverables: true } },
            },
          },
        },
      });
      return rows.map((row) => ({
        ...toFrontProspect(row),
        accessActive: (row.client?.portalUsers ?? []).some((user) => !user.disabledAt),
        deliverablesCount: row.client?._count.deliverables ?? 0,
      }));
    },

    /** Activates (invites / re-enables) or revokes a client's portal access. */
    async setClientAccess(prospectId: string, active: boolean, actorId: string) {
      if (active) {
        await grantAccess(prospectId, actorId);
      } else {
        const client = await prisma.client.findFirst({
          where: { prospectId, deletedAt: null },
          include: { portalUsers: true },
        });
        if (!client) throw new CrmError("NOT_A_CLIENT", "Ce prospect n'est pas encore client.");
        for (const user of client.portalUsers) await users.setDisabled(user.id, true, now());
        await recordAudit(prisma, {
          actorId,
          action: "client.access.revoked",
          entity: "Client",
          entityId: client.id,
        });
      }
      return { clientId: prospectId, active };
    },

    getSettings: () => settings.get(),

    async saveSettings(next: SettingsData, actorId: string): Promise<SettingsData> {
      const saved = await settings.save(next);
      await recordAudit(prisma, {
        actorId,
        action: "settings.updated",
        entity: "Setting",
        entityId: "cabinet",
      });
      return saved;
    },
  };
}

export type CrmService = ReturnType<typeof createCrmService>;
