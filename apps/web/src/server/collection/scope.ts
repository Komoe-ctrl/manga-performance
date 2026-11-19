import { canDeposit, seesWholeClient, type AppRole } from "@manga/core/roles";
import type { PrismaClient } from "@manga/db";
import { DomainError } from "../domain-error";

/** The part of a session the collection module needs (an `AppSession` fits). */
export interface CollectionActor {
  userId: string;
  role: AppRole;
  clientId: string | null;
}

type Reader = Pick<PrismaClient, "entity" | "entityAssignment">;

/**
 * Entities the actor may see (avenant n°1, §3). EVERY query of the collection module starts here:
 *  - admin: all entities;
 *  - direction and analyst: all entities of their own client;
 *  - contributor: only the entities they are assigned to (and only if still in their client).
 * An empty list means "nothing", never "everything".
 */
export async function entityScope(prisma: Reader, actor: CollectionActor): Promise<string[]> {
  if (actor.role === "ADMIN") {
    const all = await prisma.entity.findMany({ select: { id: true } });
    return all.map((e) => e.id);
  }
  if (!actor.clientId) return [];
  if (seesWholeClient(actor.role)) {
    const own = await prisma.entity.findMany({ where: { clientId: actor.clientId }, select: { id: true } });
    return own.map((e) => e.id);
  }
  const assigned = await prisma.entityAssignment.findMany({
    where: { userId: actor.userId, entity: { clientId: actor.clientId } },
    select: { entityId: true },
  });
  return assigned.map((a) => a.entityId);
}

/** Refuses an entity outside the scope with the same error as a missing one (no existence leak). */
export async function assertEntityInScope(prisma: Reader, actor: CollectionActor, entityId: string): Promise<void> {
  if (!(await entityScope(prisma, actor)).includes(entityId)) {
    throw new DomainError("NOT_FOUND", "Entité introuvable.");
  }
}

/** Analysts are read-only: nothing is uploaded on their behalf. */
export function assertCanDeposit(actor: CollectionActor): void {
  if (!canDeposit(actor.role)) {
    throw new DomainError("FORBIDDEN", "Votre rôle est en lecture seule : vous ne pouvez pas déposer de fichier.");
  }
}
