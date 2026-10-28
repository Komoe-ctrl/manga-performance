import type { Deliverable } from "@/lib/types";
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
