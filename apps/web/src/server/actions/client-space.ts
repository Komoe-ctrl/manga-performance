"use server";

import {
  notificationsQuerySchema,
  publishDeliverableSchema,
  sendAdminMessageSchema,
  sendMessageSchema,
  uploadRequestSchema,
} from "@manga/validation";
import { z } from "zod";
import type { Viewer } from "../client-space/client-space-service";
import { getClientSpace } from "../client-space/instance";
import { clientIdOfProspect } from "../client-space/lookup";
import { getPrisma } from "../db";
import { parseInput, runAdmin, runClient } from "./result";

const idSchema = z.string().min(1).max(64);

const clientViewer = (session: { userId: string; clientId: string }): Viewer => ({ userId: session.userId, role: "CLIENT", clientId: session.clientId });
const adminViewer = (session: { userId: string }): Viewer => ({ userId: session.userId, role: "ADMIN", clientId: null });

// The client never says whose data it wants: `runClient` hands over the session, and every
// call below uses the client id found in it. Admin actions go through `runAdmin`.

// ---- client space ------------------------------------------------------------------

export async function getMyCompanyAction() {
  return runClient(async (session) => {
    const client = await getPrisma().client.findUniqueOrThrow({ where: { id: session.clientId }, select: { legalName: true, prospectId: true } });
    return { companyName: client.legalName, prospectId: client.prospectId };
  });
}

export async function listMyDeliverablesAction() {
  return runClient((session) => getClientSpace().listDeliverables(session.clientId, clientViewer(session)));
}

export async function markDeliverableSeenAction(id: unknown) {
  return runClient(async (session) => {
    await getClientSpace().markDeliverableSeen(clientViewer(session), parseInput(idSchema, id));
    return { ok: true };
  });
}

export async function listMyMessagesAction() {
  return runClient((session) => getClientSpace().listMessages(session.clientId));
}

export async function requestMyAttachmentUploadAction(input: unknown) {
  return runClient((session) => getClientSpace().requestAttachmentUpload(session.clientId, parseInput(uploadRequestSchema, input)));
}

export async function sendMyMessageAction(input: unknown) {
  return runClient((session) => {
    const data = parseInput(sendMessageSchema, input);
    return getClientSpace().sendMessage({ clientId: session.clientId, fromRole: "CLIENT", authorId: session.userId, body: data.body, attachment: data.attachment });
  });
}

export async function markMyThreadReadAction() {
  return runClient((session) => getClientSpace().markThreadRead(clientViewer(session), session.clientId));
}

/** In-app notifications of the signed-in client user, paginated (spec, 6.5). */
export async function listMyNotificationsAction(query: unknown) {
  return runClient((session) => getClientSpace().listNotifications(session.userId, parseInput(notificationsQuerySchema, query ?? {})));
}

/** The shape the existing screens expect: unread, deliverables and messages only. */
export async function listMyUnreadNotificationsAction() {
  return runClient(async (session) => {
    const { items } = await getClientSpace().listNotifications(session.userId, { unreadOnly: true, limit: 50 });
    return items.filter((item) => item.kind === "livrable" || item.kind === "message").map(({ id, kind, title, at, href }) => ({ id, kind: kind as "livrable" | "message", title, at, href }));
  });
}

export async function myUnreadNotificationCountAction() {
  return runClient((session) => getClientSpace().unreadNotificationCount(session.userId));
}

export async function markNotificationReadAction(id: unknown) {
  return runClient(async (session) => ({ marked: await getClientSpace().markNotificationRead(session.userId, parseInput(idSchema, id)) }));
}

export async function markAllNotificationsReadAction() {
  return runClient(async (session) => ({ marked: await getClientSpace().markAllNotificationsRead(session.userId) }));
}

// ---- back-office -------------------------------------------------------------------

export async function requestDeliverableUploadAction(prospectId: unknown, input: unknown) {
  return runAdmin(async () => {
    const request = parseInput(uploadRequestSchema, input); // validate before any lookup
    const clientId = await clientIdOfProspect(getPrisma(), parseInput(idSchema, prospectId));
    return getClientSpace().requestDeliverableUpload(clientId, request);
  });
}

export async function publishDeliverableAction(input: unknown) {
  return runAdmin(async (admin) => {
    const data = parseInput(publishDeliverableSchema, input);
    return getClientSpace().publishDeliverable({ clientId: await clientIdOfProspect(getPrisma(), data.clientId), title: data.title, key: data.key }, admin.userId);
  });
}

export async function listClientDeliverablesAction(prospectId: unknown) {
  return runAdmin(async (admin) => getClientSpace().listDeliverables(await clientIdOfProspect(getPrisma(), parseInput(idSchema, prospectId)), adminViewer(admin)));
}

export async function listClientMessagesAction(prospectId: unknown) {
  return runAdmin(async () => getClientSpace().listMessages(await clientIdOfProspect(getPrisma(), parseInput(idSchema, prospectId))));
}

export async function requestAdminAttachmentUploadAction(prospectId: unknown, input: unknown) {
  return runAdmin(async () => {
    const request = parseInput(uploadRequestSchema, input);
    const clientId = await clientIdOfProspect(getPrisma(), parseInput(idSchema, prospectId));
    return getClientSpace().requestAttachmentUpload(clientId, request);
  });
}

export async function sendAdminMessageAction(input: unknown) {
  return runAdmin(async (admin) => {
    const data = parseInput(sendAdminMessageSchema, input);
    return getClientSpace().sendMessage({
      clientId: await clientIdOfProspect(getPrisma(), data.clientId),
      fromRole: "ADMIN",
      authorId: admin.userId,
      body: data.body,
      attachment: data.attachment,
    });
  });
}

export async function markClientThreadReadAction(prospectId: unknown) {
  return runAdmin(async (admin) => getClientSpace().markThreadRead(adminViewer(admin), await clientIdOfProspect(getPrisma(), parseInput(idSchema, prospectId))));
}
