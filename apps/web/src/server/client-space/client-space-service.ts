import { FILE_KINDS, extensionOf, sanitizeFilename, type FileKind } from "@manga/core/files";
import type { Prisma, PrismaClient } from "@manga/db";
import type { Deliverable, Message } from "@/lib/types";
import { DomainError } from "../domain-error";
import { createUploadService, type UploadTicket } from "../files/upload-service";
import type { Enqueuer } from "../queue";
import { recordAudit } from "../repositories/audit";
import { DOWNLOAD_URL_SECONDS, type ObjectStorage } from "../storage/object-storage";

export interface ClientSpaceDeps {
  prisma: PrismaClient;
  storage: ObjectStorage;
  queue: Pick<Enqueuer, "enqueueEmail" | "enqueueFanout">;
  appUrl: string;
  adminEmail: string;
  now?: () => Date;
}

/** Who is asking: taken from the session, never from the request. */
export interface Viewer {
  userId: string;
  role: "ADMIN" | "CLIENT";
  clientId: string | null;
}

export class ClientSpaceError extends DomainError {
  constructor(code: "NOT_FOUND" | "INVALID" | "CLIENT_NOT_FOUND", message: string) {
    super(code, message);
    this.name = "ClientSpaceError";
  }
}

const MAX_BODY = 5000;
const MAX_TITLE = 200;

export interface NotificationItem {
  id: string;
  type: string;
  kind: "livrable" | "message" | "autre";
  title: string;
  at: string;
  href: string;
  read: boolean;
}

function describeNotification(type: string, payload: unknown): Pick<NotificationItem, "kind" | "title" | "href"> {
  const data = (payload ?? {}) as Record<string, unknown>;
  switch (type) {
    case "NEW_DELIVERABLE":
      return { kind: "livrable", title: `Nouveau livrable : ${String(data.title ?? "")}`.trim(), href: "/espace-client" };
    case "NEW_MESSAGE":
      return { kind: "message", title: "Nouveau message du consultant", href: "/espace-client/messages" };
    case "NEW_LEAD":
      return { kind: "autre", title: data.returning ? "Un contact existant vous a réécrit" : "Nouveau prospect", href: `/admin/prospects/${String(data.prospectId ?? "")}` };
    case "FOLLOW_UP_DUE":
      return { kind: "autre", title: "Relances à traiter", href: "/admin/relances" };
    default:
      return { kind: "autre", title: type, href: "/" };
  }
}

const kindOfMime = (mime: string): FileKind =>
  (Object.keys(FILE_KINDS) as FileKind[]).find((kind) => FILE_KINDS[kind].mime === mime) ?? "pdf";

/**
 * Client space (spec, 6.5): deliverables, asynchronous messages and in-app notifications.
 * Every read for a client is scoped by the viewer's own `clientId`; a deliverable or
 * attachment of another client is indistinguishable from one that does not exist.
 */
export function createClientSpaceService(deps: ClientSpaceDeps) {
  const { prisma, storage, queue, appUrl, adminEmail, now = () => new Date() } = deps;
  const uploads = createUploadService({ storage });
  const base = appUrl.replace(/\/$/, "");

  async function prospectIdOf(clientId: string): Promise<string> {
    const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { prospectId: true } });
    if (!client) throw new ClientSpaceError("CLIENT_NOT_FOUND", "Client introuvable.");
    return client.prospectId;
  }

  const activePortalUsers = (clientId: string) =>
    prisma.user.findMany({ where: { clientId, role: "CLIENT", disabledAt: null }, select: { id: true, name: true, email: true } });

  const scopeDeliverable = (viewer: Viewer, id: string): Prisma.DeliverableWhereInput =>
    viewer.role === "CLIENT" ? { id, clientId: viewer.clientId ?? "__none__" } : { id };

  const scopeMessage = (viewer: Viewer, id: string): Prisma.MessageWhereInput =>
    viewer.role === "CLIENT" ? { id, clientId: viewer.clientId ?? "__none__" } : { id };

  async function presign(key: string, filename: string): Promise<{ url: string; expiresInSeconds: number }> {
    return { url: await storage.presignDownload({ key, filename }), expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  return {
    // ----- uploads -----------------------------------------------------------------

    /** Admin: presigned upload for a deliverable of `clientId`. */
    requestDeliverableUpload: (clientId: string, input: { filename: string; mimeType: string; sizeBytes: number }): Promise<UploadTicket> =>
      uploads.requestUpload(clientId, input),

    /** Presigned upload for a message attachment. The caller passes the session's own client id. */
    requestAttachmentUpload: (clientId: string, input: { filename: string; mimeType: string; sizeBytes: number }): Promise<UploadTicket> =>
      uploads.requestUpload(clientId, input),

    // ----- deliverables --------------------------------------------------------------

    /**
     * Publishes an uploaded file to a client: the file is verified (size, magic number,
     * SHA-256), recorded, audited, and every active portal user is notified in the app
     * and by email.
     */
    async publishDeliverable(input: { clientId: string; title: string; key: string }, actorId: string): Promise<Deliverable> {
      const title = input.title.trim();
      if (!title || title.length > MAX_TITLE) throw new ClientSpaceError("INVALID", "Indiquez un titre (200 caractères maximum).");
      const prospectId = await prospectIdOf(input.clientId);
      const file = await uploads.verifyUploaded(input.clientId, input.key);

      const deliverable = await prisma.$transaction(async (tx) => {
        const created = await tx.deliverable.create({
          data: { clientId: input.clientId, title, storageKey: file.key, mimeType: file.mimeType, sizeBytes: file.sizeBytes, checksum: file.checksum, publishedBy: actorId },
        });
        await recordAudit(tx, { actorId, action: "deliverable.published", entity: "Deliverable", entityId: created.id, diff: { clientId: input.clientId, sizeBytes: file.sizeBytes } });
        return created;
      });

      for (const user of await activePortalUsers(input.clientId)) {
        await queue.enqueueFanout(
          {
            type: "NEW_DELIVERABLE",
            audience: { userId: user.id },
            payload: { deliverableId: deliverable.id, title },
            email: { template: "new-deliverable", to: user.email, data: { name: user.name, title, url: `${base}/espace-client` } },
          },
          { dedupeKey: `deliverable:${deliverable.id}:${user.id}` },
        );
      }
      return this.toFrontDeliverable(deliverable, prospectId, new Set([deliverable.id]));
    },

    toFrontDeliverable(row: { id: string; title: string; mimeType: string; sizeBytes: number; publishedAt: Date }, prospectId: string, fresh: Set<string>): Deliverable {
      return {
        id: row.id,
        clientId: prospectId,
        title: row.title,
        fileType: kindOfMime(row.mimeType),
        sizeKb: Math.max(1, Math.ceil(row.sizeBytes / 1024)),
        publishedAt: row.publishedAt.toISOString(),
        isNew: fresh.has(row.id),
      };
    },

    /** A client's deliverables, newest first; `isNew` = still unread by this viewer. */
    async listDeliverables(clientId: string, viewer: Viewer): Promise<Deliverable[]> {
      const prospectId = await prospectIdOf(clientId);
      const rows = await prisma.deliverable.findMany({ where: { clientId }, orderBy: { publishedAt: "desc" } });
      const fresh = new Set<string>();
      if (viewer.role === "CLIENT") {
        const unread = await prisma.notification.findMany({ where: { userId: viewer.userId, type: "NEW_DELIVERABLE", readAt: null } });
        for (const n of unread) fresh.add(String((n.payload as { deliverableId?: unknown }).deliverableId));
      }
      return rows.map((row) => this.toFrontDeliverable(row, prospectId, fresh));
    },

    /** 5-minute presigned download, logged. Another client's file answers NOT_FOUND. */
    async deliverableDownload(viewer: Viewer, deliverableId: string): Promise<{ url: string; expiresInSeconds: number }> {
      const row = await prisma.deliverable.findFirst({ where: scopeDeliverable(viewer, deliverableId) });
      if (!row) throw new ClientSpaceError("NOT_FOUND", "Livrable introuvable.");

      await prisma.deliverableDownload.create({ data: { deliverableId: row.id, userId: viewer.userId, downloadedAt: now() } });
      const extension = FILE_KINDS[kindOfMime(row.mimeType)].extensions[0]!;
      return presign(row.storageKey, `${sanitizeFilename(row.title, "livrable")}.${extension}`);
    },

    /** The client opened or downloaded the deliverable: its "new" notification is read. */
    async markDeliverableSeen(viewer: Viewer, deliverableId: string): Promise<void> {
      const row = await prisma.deliverable.findFirst({ where: scopeDeliverable(viewer, deliverableId), select: { id: true } });
      if (!row) return;
      await prisma.notification.updateMany({
        where: { userId: viewer.userId, type: "NEW_DELIVERABLE", readAt: null, payload: { path: ["deliverableId"], equals: row.id } },
        data: { readAt: now() },
      });
    },

    // ----- messages ------------------------------------------------------------------

    async listMessages(clientId: string): Promise<Message[]> {
      const prospectId = await prospectIdOf(clientId);
      const rows = await prisma.message.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => ({
        id: row.id,
        clientId: prospectId,
        from: row.fromRole === "CLIENT" ? "client" : "consultant",
        body: row.body,
        sentAt: row.createdAt.toISOString(),
        read: row.readAt !== null,
        attachment: row.attachmentName ?? undefined,
      }));
    },

    /**
     * Posts a message and notifies the other side. The email only points to the client
     * space: it never contains the message (spec, 6.5).
     */
    async sendMessage(
      input: { clientId: string; fromRole: "ADMIN" | "CLIENT"; authorId: string; body: string; attachment?: { key: string; filename: string } },
    ): Promise<Message> {
      const body = input.body.trim();
      if (!body || body.length > MAX_BODY) throw new ClientSpaceError("INVALID", "Le message doit contenir entre 1 et 5 000 caractères.");
      const prospectId = await prospectIdOf(input.clientId);
      const client = await prisma.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { legalName: true } });

      let attachment: { key: string; name: string; mime: string; size: number } | undefined;
      if (input.attachment) {
        const file = await uploads.verifyUploaded(input.clientId, input.attachment.key);
        attachment = { key: file.key, name: sanitizeFilename(input.attachment.filename), mime: file.mimeType, size: file.sizeBytes };
      }

      const row = await prisma.message.create({
        data: {
          clientId: input.clientId,
          authorId: input.authorId,
          fromRole: input.fromRole,
          body,
          attachmentKey: attachment?.key,
          attachmentName: attachment?.name,
          attachmentMime: attachment?.mime,
          attachmentSize: attachment?.size,
          createdAt: now(),
        },
      });

      if (input.fromRole === "CLIENT") {
        await queue.enqueueFanout(
          {
            type: "NEW_MESSAGE",
            audience: "ADMINS",
            payload: { clientId: input.clientId, messageId: row.id },
            email: { template: "new-message", to: adminEmail, data: { name: client.legalName, url: `${base}/admin/clients` } },
          },
          { dedupeKey: `message:${row.id}` },
        );
      } else {
        for (const user of await activePortalUsers(input.clientId)) {
          await queue.enqueueFanout(
            {
              type: "NEW_MESSAGE",
              audience: { userId: user.id },
              payload: { clientId: input.clientId, messageId: row.id },
              email: { template: "new-message", to: user.email, data: { name: user.name, url: `${base}/espace-client/messages` } },
            },
            { dedupeKey: `message:${row.id}:${user.id}` },
          );
        }
      }
      return { id: row.id, clientId: prospectId, from: input.fromRole === "CLIENT" ? "client" : "consultant", body, sentAt: row.createdAt.toISOString(), read: false, attachment: attachment?.name };
    },

    /** Opening the thread marks the other side's messages (and their notifications) as read. */
    async markThreadRead(viewer: Viewer, clientId: string): Promise<{ marked: number }> {
      const { count } = await prisma.message.updateMany({
        where: { clientId, readAt: null, fromRole: viewer.role === "CLIENT" ? "ADMIN" : "CLIENT" },
        data: { readAt: now() },
      });
      await prisma.notification.updateMany({
        where: { userId: viewer.userId, type: "NEW_MESSAGE", readAt: null, payload: { path: ["clientId"], equals: clientId } },
        data: { readAt: now() },
      });
      return { marked: count };
    },

    /** Presigned download of a message attachment, logged. Scoped like deliverables. */
    async attachmentDownload(viewer: Viewer, messageId: string): Promise<{ url: string; expiresInSeconds: number }> {
      const row = await prisma.message.findFirst({ where: { ...scopeMessage(viewer, messageId), attachmentKey: { not: null } } });
      if (!row?.attachmentKey) throw new ClientSpaceError("NOT_FOUND", "Pièce jointe introuvable.");
      await recordAudit(prisma, { actorId: viewer.userId, action: "message.attachment.downloaded", entity: "Message", entityId: row.id });
      return presign(row.attachmentKey, row.attachmentName ?? `piece-jointe.${extensionOf(row.attachmentKey)}`);
    },

    // ----- notifications -------------------------------------------------------------

    /** Paginated, newest first. Only the viewer's own notifications are ever visible. */
    async listNotifications(userId: string, options: { unreadOnly?: boolean; cursor?: string; limit?: number } = {}): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
      const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
      const rows = await prisma.notification.findMany({
        where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map((row) => ({ id: row.id, type: row.type, at: row.createdAt.toISOString(), read: row.readAt !== null, ...describeNotification(row.type, row.payload) })),
        nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      };
    },

    unreadNotificationCount: (userId: string) => prisma.notification.count({ where: { userId, readAt: null } }),

    async markNotificationRead(userId: string, id: string): Promise<boolean> {
      const { count } = await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: now() } });
      return count === 1;
    },

    async markAllNotificationsRead(userId: string): Promise<number> {
      const { count } = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now() } });
      return count;
    },
  };
}

export type ClientSpaceService = ReturnType<typeof createClientSpaceService>;
