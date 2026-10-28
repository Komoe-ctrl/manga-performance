import { db, latency } from "./store";

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
