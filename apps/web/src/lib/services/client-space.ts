import type { Deliverable, Message } from "@/lib/types";
import { db, latency, nextId } from "./store";

export const listClients = () =>
  latency(() =>
    db.prospects
      .filter((p) => p.status === "client")
      .map((c) => ({
        ...c,
        accessActive: db.clientAccess.find((a) => a.clientId === c.id)?.active ?? false,
        deliverablesCount: db.deliverables.filter((d) => d.clientId === c.id).length,
      })),
  );
export const listDeliverables = (clientId: string) =>
  latency(() => db.deliverables.filter((d) => d.clientId === clientId));
export const listMessages = (clientId: string) =>
  latency(() => db.messages.filter((m) => m.clientId === clientId));

export const publishDeliverable = (
  input: Pick<Deliverable, "clientId" | "title" | "fileType" | "sizeKb">,
) =>
  latency(() => {
    const d: Deliverable = {
      ...input,
      id: nextId("d"),
      publishedAt: new Date().toISOString(),
      isNew: true,
    };
    db.deliverables.unshift(d);
    return d;
  });

export const setClientAccess = (clientId: string, active: boolean) =>
  latency(() => {
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

export const listNotifications = (clientId: string) =>
  latency((): Notification[] => [
    ...db.deliverables
      .filter((d) => d.clientId === clientId && d.isNew)
      .map((d) => ({ id: `n-${d.id}`, kind: "livrable" as const, title: `Nouveau livrable : ${d.title}`, at: d.publishedAt, href: "/espace-client" })),
    ...db.messages
      .filter((m) => m.clientId === clientId && m.from === "consultant" && !m.read)
      .map((m) => ({ id: `n-${m.id}`, kind: "message" as const, title: "Nouveau message du consultant", at: m.sentAt, href: "/espace-client/messages" })),
  ].sort((a, b) => b.at.localeCompare(a.at)));

export const markDeliverableSeen = (id: string) =>
  latency(() => {
    const d = db.deliverables.find((x) => x.id === id);
    if (d) d.isNew = false;
  });

/** Le client ouvre le fil : les messages du consultant passent en « lu ». */
export const markMessagesRead = (clientId: string) =>
  latency(() => {
    db.messages.filter((m) => m.clientId === clientId && m.from === "consultant").forEach((m) => (m.read = true));
  });

export const sendClientMessage = (clientId: string, body: string, attachment?: string) =>
  latency(() => {
    const m: Message = {
      id: nextId("m"),
      clientId,
      from: "client",
      body,
      sentAt: new Date().toISOString(),
      read: false, // lu par le consultant : pas dans la maquette
      attachment,
    };
    db.messages.push(m);
    return m;
  });

/** Connexion simulée : email d'un client avec accès actif, mot de passe de 4 caractères minimum. */
export const authenticateClient = (email: string, password: string) =>
  latency(() => {
    const client = db.prospects.find((p) => p.status === "client" && p.email?.toLowerCase() === email.trim().toLowerCase());
    if (!client || password.length < 4) return { ok: false as const, reason: "Identifiants invalides." };
    const access = db.clientAccess.find((a) => a.clientId === client.id);
    if (!access?.active) return { ok: false as const, reason: "Accès à l'espace client non activé. Contactez votre consultant." };
    return { ok: true as const, clientId: client.id };
  });
