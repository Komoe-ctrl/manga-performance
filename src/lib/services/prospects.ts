import type { FollowUp, Interaction, Prospect, ProspectStatus } from "@/lib/types";
import { db, latency, nextId } from "./store";

export const listProspects = () => latency(() => [...db.prospects]);
export const getProspect = (id: string) =>
  latency(() => db.prospects.find((p) => p.id === id) ?? null);

export type NewProspect = Omit<Prospect, "id" | "createdAt" | "status"> & {
  status?: ProspectStatus;
};
export const createProspect = (input: NewProspect) =>
  latency(() => {
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
) =>
  latency(() => {
    const p = db.prospects.find((x) => x.id === id);
    if (!p) throw new Error("Prospect introuvable");
    p.status = status;
    if (status === "client" && options.createAccess && !db.clientAccess.some((a) => a.clientId === id)) {
      db.clientAccess.push({ clientId: id, active: true });
    }
    return p;
  });

export const listInteractions = (prospectId: string) =>
  latency(() => db.interactions.filter((i) => i.prospectId === prospectId));
export const addInteraction = (input: Omit<Interaction, "id">) =>
  latency(() => {
    const i = { ...input, id: nextId("i") };
    db.interactions.unshift(i);
    return i;
  });

export const listFollowUps = () => latency(() => [...db.followUps]);
export const addFollowUp = (input: Omit<FollowUp, "id" | "done">) =>
  latency(() => {
    const f = { ...input, id: nextId("f"), done: false };
    db.followUps.push(f);
    return f;
  });
export const completeFollowUp = (id: string) =>
  latency(() => {
    const f = db.followUps.find((x) => x.id === id);
    if (f) f.done = true;
    return f ?? null;
  });
