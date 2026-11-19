import type { Sector } from "@manga/db";
import type { PrismaClient } from "@manga/db";
import { DomainError } from "../domain-error";
import { recordAudit } from "../repositories/audit";
import { entityScope, type CollectionActor } from "./scope";

export interface EntityView {
  id: string;
  clientId: string;
  name: string;
  sector: Sector;
  active: boolean;
}

const select = { id: true, clientId: true, name: true, sector: true, active: true } as const;

export function createEntityService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  return {
    /** Entities the actor may see, through `entityScope`. */
    async listEntities(actor: CollectionActor): Promise<EntityView[]> {
      const scope = await entityScope(prisma, actor);
      return prisma.entity.findMany({ where: { id: { in: scope } }, select, orderBy: { name: "asc" } });
    },

    /** `null` when the entity does not exist or is outside the scope: callers cannot tell which. */
    async getEntity(actor: CollectionActor, entityId: string): Promise<EntityView | null> {
      const scope = await entityScope(prisma, actor);
      if (!scope.includes(entityId)) return null;
      return prisma.entity.findUnique({ where: { id: entityId }, select });
    },

    /** Admin only (the caller runs behind `requireAdmin`). */
    async createEntity(input: { clientId: string; name: string; sector: Sector }, actorId: string): Promise<EntityView> {
      const name = input.name.trim();
      if (name.length < 2) throw new DomainError("VALIDATION", "Le nom de l'entité est requis.");
      const client = await prisma.client.findFirst({ where: { id: input.clientId, deletedAt: null }, select: { id: true } });
      if (!client) throw new DomainError("CLIENT_NOT_FOUND", "Client introuvable.");
      if (await prisma.entity.findUnique({ where: { clientId_name: { clientId: input.clientId, name } }, select: { id: true } })) {
        throw new DomainError("DUPLICATE", "Une entité porte déjà ce nom chez ce client.");
      }
      return prisma.$transaction(async (tx) => {
        const entity = await tx.entity.create({ data: { clientId: input.clientId, name, sector: input.sector }, select });
        await recordAudit(tx, { actorId, action: "entity.create", entity: "Entity", entityId: entity.id, diff: { name, sector: input.sector } });
        return entity;
      });
    },

    /**
     * Assigns a contributor to an entity. Both must belong to the same client: a contributor
     * can never be attached to another client's entity. Audited (avenant §9).
     */
    async assignContributor(entityId: string, userId: string, actorId: string): Promise<void> {
      const [entity, user] = await Promise.all([
        prisma.entity.findUnique({ where: { id: entityId }, select: { id: true, clientId: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, clientId: true, disabledAt: true } }),
      ]);
      if (!entity) throw new DomainError("NOT_FOUND", "Entité introuvable.");
      if (!user || user.role !== "CLIENT_CONTRIBUTEUR") throw new DomainError("NOT_CONTRIBUTOR", "Seul un utilisateur « contributeur » peut être affecté à une entité.");
      if (user.clientId !== entity.clientId) throw new DomainError("OTHER_CLIENT", "Cet utilisateur n'appartient pas au client de cette entité.");
      await prisma.$transaction(async (tx) => {
        await tx.entityAssignment.upsert({ where: { userId_entityId: { userId, entityId } }, create: { userId, entityId }, update: {} });
        await recordAudit(tx, { actorId, action: "entity.assign", entity: "Entity", entityId, diff: { userId } });
      });
    },

    async unassignContributor(entityId: string, userId: string, actorId: string): Promise<void> {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.entityAssignment.deleteMany({ where: { userId, entityId } });
        if (count > 0) await recordAudit(tx, { actorId, action: "entity.unassign", entity: "Entity", entityId, diff: { userId } });
      });
    },
  };
}

export type EntityService = ReturnType<typeof createEntityService>;
