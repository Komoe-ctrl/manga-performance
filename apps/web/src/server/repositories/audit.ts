import type { Prisma, PrismaClient } from "@manga/db";

/** Accepts the client and interactive-transaction clients alike. */
export type AuditWriter = Pick<PrismaClient, "auditLog">;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  diff?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Appends to the audit log (spec, section 3). Never put secrets or message bodies in `diff`. */
export async function recordAudit(prisma: AuditWriter, entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      diff: entry.diff,
      ip: entry.ip ?? null,
    },
  });
}
