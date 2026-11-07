import type { Deliverable, Message, Prospect } from "@/lib/types";
import * as space from "@/server/actions/client-space";
import * as crm from "@/server/actions/crm";
import { ServiceError, USE_DB, unwrap } from "./data-source";
import { db, latency, nextId } from "./store";

export const listClients = () =>
  USE_DB
    ? unwrap(crm.listClientsAction())
    : latency(() =>
        db.prospects
          .filter((p) => p.status === "client")
          .map((c) => ({
            ...c,
            accessActive: db.clientAccess.find((a) => a.clientId === c.id)?.active ?? false,
            deliverablesCount: db.deliverables.filter((d) => d.clientId === c.id).length,
          })),
      );

/** `DATA_SOURCE=db`: the signed-in client's own deliverables (the session decides which client). */
export const listDeliverables = (clientId: string): Promise<Deliverable[]> =>
  USE_DB ? unwrap(space.listMyDeliverablesAction()) : latency(() => db.deliverables.filter((d) => d.clientId === clientId));

export const listMessages = (clientId: string): Promise<Message[]> =>
  USE_DB ? unwrap(space.listMyMessagesAction()) : latency(() => db.messages.filter((m) => m.clientId === clientId));

/** Sends the file straight to private storage with the presigned URL the server gave. */
async function putToStorage(ticket: { uploadUrl: string; headers: Record<string, string> }, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: file });
  } catch {
    throw new ServiceError("Impossible d'envoyer le fichier. Vérifiez votre connexion.", "NETWORK");
  }
  if (!response.ok) throw new ServiceError("L'envoi du fichier a échoué. Réessayez.", String(response.status));
}

const describeFile = (file: File) => ({ filename: file.name, mimeType: file.type, sizeBytes: file.size });

/**
 * `DATA_SOURCE=db`: uploads the file (presigned URL), then the server verifies it (size,
 * content, checksum), records it and notifies the client. `mock`: metadata only.
 */
export const publishDeliverable = async (
  input: Pick<Deliverable, "clientId" | "title" | "fileType" | "sizeKb"> & { file?: File },
): Promise<Deliverable> => {
  if (USE_DB) {
    if (!input.file) throw new ServiceError("Choisissez un fichier à publier.", "INVALID");
    const ticket = await unwrap(space.requestDeliverableUploadAction(input.clientId, describeFile(input.file)));
    await putToStorage(ticket, input.file);
    return unwrap(space.publishDeliverableAction({ clientId: input.clientId, title: input.title, key: ticket.key }));
  }
  return latency(() => {
    const d: Deliverable = {
      clientId: input.clientId,
      title: input.title,
      fileType: input.fileType,
      sizeKb: input.sizeKb,
      id: nextId("d"),
      publishedAt: new Date().toISOString(),
      isNew: true,
    };
    db.deliverables.unshift(d);
    return d;
  });
};

export const setClientAccess = (clientId: string, active: boolean) =>
  USE_DB
    ? unwrap(crm.setClientAccessAction(clientId, active))
    : latency(() => {
        const access = db.clientAccess.find((a) => a.clientId === clientId);
        if (access) access.active = active;
        else db.clientAccess.push({ clientId, active });
        return { clientId, active };
      });

export interface Notification {
  id: string;
  kind: "livrable" | "message";
  title: string;
  at: string;
  href: string;
}

export const listNotifications = (clientId: string): Promise<Notification[]> =>
  USE_DB
    ? unwrap(space.listMyUnreadNotificationsAction())
    : latency((): Notification[] =>
        [
          ...db.deliverables
            .filter((d) => d.clientId === clientId && d.isNew)
            .map((d) => ({ id: `n-${d.id}`, kind: "livrable" as const, title: `Nouveau livrable : ${d.title}`, at: d.publishedAt, href: "/espace-client" })),
          ...db.messages
            .filter((m) => m.clientId === clientId && m.from === "consultant" && !m.read)
            .map((m) => ({ id: `n-${m.id}`, kind: "message" as const, title: "Nouveau message du consultant", at: m.sentAt, href: "/espace-client/messages" })),
        ].sort((a, b) => b.at.localeCompare(a.at)),
      );

export const markDeliverableSeen = async (id: string): Promise<void> => {
  if (USE_DB) {
    await unwrap(space.markDeliverableSeenAction(id));
    return;
  }
  await latency(() => {
    const d = db.deliverables.find((x) => x.id === id);
    if (d) d.isNew = false;
  });
};

/** Le client ouvre le fil : les messages du consultant passent en « lu ». */
export const markMessagesRead = async (clientId: string): Promise<void> => {
  if (USE_DB) {
    await unwrap(space.markMyThreadReadAction());
    return;
  }
  await latency(() => {
    db.messages.filter((m) => m.clientId === clientId && m.from === "consultant").forEach((m) => (m.read = true));
  });
};

/** `attachment`: the file itself in `db` mode; only its name is kept by the mock. */
export const sendClientMessage = async (clientId: string, body: string, attachment?: File | string): Promise<Message> => {
  if (USE_DB) {
    let uploaded: { key: string; filename: string } | undefined;
    if (attachment instanceof File) {
      const ticket = await unwrap(space.requestMyAttachmentUploadAction(describeFile(attachment)));
      await putToStorage(ticket, attachment);
      uploaded = { key: ticket.key, filename: attachment.name };
    }
    return unwrap(space.sendMyMessageAction({ body, attachment: uploaded }));
  }
  return latency(() => {
    const m: Message = {
      id: nextId("m"),
      clientId,
      from: "client",
      body,
      sentAt: new Date().toISOString(),
      read: false, // lu par le consultant : pas dans la maquette
      attachment: typeof attachment === "string" ? attachment : attachment?.name,
    };
    db.messages.push(m);
    return m;
  });
};

/** A plain link click: the browser follows the redirect to private storage and saves the file. */
function startDownload(href: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** The server checks access, logs the download, then redirects to a 5-minute presigned link. */
export const downloadDeliverable = (id: string): void => startDownload(`/api/deliverables/${encodeURIComponent(id)}/download`);

export const downloadMessageAttachment = (messageId: string): void => startDownload(`/api/messages/${encodeURIComponent(messageId)}/attachment`);

/** Name shown in the client-space header. The mock reads the prospect; `db` asks the session's own company. */
export const getClientCompany = async (clientId: string): Promise<{ companyName: string } | null> => {
  if (USE_DB) return unwrap(space.getMyCompanyAction());
  const prospect: Prospect | null = await latency(() => db.prospects.find((p) => p.id === clientId) ?? null);
  return prospect ? { companyName: prospect.companyName } : null;
};

/** Connexion simulée : email d'un client avec accès actif, mot de passe de 4 caractères minimum. */
export const authenticateClient = (email: string, password: string) =>
  latency(() => {
    const client = db.prospects.find((p) => p.status === "client" && p.email?.toLowerCase() === email.trim().toLowerCase());
    if (!client || password.length < 4) return { ok: false as const, reason: "Identifiants invalides." };
    const access = db.clientAccess.find((a) => a.clientId === client.id);
    if (!access?.active) return { ok: false as const, reason: "Accès à l'espace client non activé. Contactez votre consultant." };
    return { ok: true as const, clientId: client.id };
  });
