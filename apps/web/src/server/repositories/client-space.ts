import { clientScope, type ClientSession } from "../auth/guards";
import { getPrisma } from "../db";

/**
 * Client-space reads. Every query is scoped with `clientScope(session)`: the
 * client id never comes from the browser. Later steps extend this file.
 */

export function listInvoices(session: ClientSession) {
  return getPrisma().invoice.findMany({
    // Drafts are internal to the firm.
    where: { ...clientScope(session), status: { not: "BROUILLON" } },
    orderBy: { createdAt: "desc" },
  });
}

export function getInvoice(session: ClientSession, id: string) {
  return getPrisma().invoice.findFirst({
    where: { id, ...clientScope(session), status: { not: "BROUILLON" } },
    include: { lines: true },
  });
}

export function listDeliverables(session: ClientSession) {
  return getPrisma().deliverable.findMany({
    where: clientScope(session),
    orderBy: { publishedAt: "desc" },
  });
}

export function getDeliverable(session: ClientSession, id: string) {
  return getPrisma().deliverable.findFirst({ where: { id, ...clientScope(session) } });
}

export function listMessages(session: ClientSession) {
  return getPrisma().message.findMany({
    where: clientScope(session),
    orderBy: { createdAt: "asc" },
  });
}

export function listNotifications(session: ClientSession) {
  // Notifications belong to a user, not to a client company.
  return getPrisma().notification.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
  });
}
