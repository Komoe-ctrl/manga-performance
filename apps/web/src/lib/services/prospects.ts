import type { FollowUp, Interaction, Prospect, ProspectStatus } from "@/lib/types";
import * as crm from "@/server/actions/crm";
import { USE_DB, unwrap } from "./data-source";
import { db, latency, nextId } from "./store";

export const listProspects = (): Promise<Prospect[]> =>
  USE_DB ? unwrap(crm.listProspectsAction()) : latency(() => [...db.prospects]);

export const getProspect = (id: string): Promise<Prospect | null> =>
  USE_DB
    ? unwrap(crm.getProspectAction(id))
    : latency(() => db.prospects.find((p) => p.id === id) ?? null);

export type NewProspect = Omit<Prospect, "id" | "createdAt" | "status"> & {
  status?: ProspectStatus;
};
export const createProspect = (input: NewProspect): Promise<Prospect> =>
  USE_DB
    ? unwrap(crm.createProspectAction(input))
    : latency(() => {
        const prospect: Prospect = {
          status: "nouveau",
          ...input,
          id: nextId("p"),
          createdAt: new Date().toISOString(),
        };
        db.prospects.unshift(prospect);
        return prospect;
      });

export const updateProspectStatus = (
  id: string,
  status: ProspectStatus,
  options: { createAccess?: boolean } = {},
): Promise<Prospect> =>
  USE_DB
    ? unwrap(crm.updateProspectStatusAction({ id, status, createAccess: options.createAccess }))
    : latency(() => {
        const p = db.prospects.find((x) => x.id === id);
        if (!p) throw new Error("Prospect introuvable");
        p.status = status;
        if (status === "client" && options.createAccess && !db.clientAccess.some((a) => a.clientId === id)) {
          db.clientAccess.push({ clientId: id, active: true });
        }
        return p;
      });

export const listInteractions = (prospectId: string): Promise<Interaction[]> =>
  USE_DB
    ? unwrap(crm.listInteractionsAction(prospectId))
    : latency(() => db.interactions.filter((i) => i.prospectId === prospectId));

export const addInteraction = (input: Omit<Interaction, "id">): Promise<Interaction> =>
  USE_DB
    ? unwrap(crm.addInteractionAction(input))
    : latency(() => {
        const i = { ...input, id: nextId("i") };
        db.interactions.unshift(i);
        return i;
      });

export const listFollowUps = (): Promise<FollowUp[]> =>
  USE_DB ? unwrap(crm.listFollowUpsAction()) : latency(() => [...db.followUps]);

export const addFollowUp = (input: Omit<FollowUp, "id" | "done">): Promise<FollowUp> =>
  USE_DB
    ? unwrap(crm.addFollowUpAction(input))
    : latency(() => {
        const f = { ...input, id: nextId("f"), done: false };
        db.followUps.push(f);
        return f;
      });

export const completeFollowUp = (id: string): Promise<FollowUp | null> =>
  USE_DB
    ? unwrap(crm.completeFollowUpAction(id))
    : latency(() => {
        const f = db.followUps.find((x) => x.id === id);
        if (f) f.done = true;
        return f ?? null;
      });
