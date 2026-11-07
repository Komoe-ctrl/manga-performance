import type { FollowUp, Interaction, Prospect, ProspectStatus } from "@/lib/types";
import * as crm from "@/server/actions/crm";
import { ServiceError, USE_DB, unwrap } from "./data-source";
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

export interface LeadSubmission {
  source: "site_formulaire" | "chatbot" | "demo";
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  sector?: string;
  need?: Prospect["need"];
  message?: string;
  /** Consent to the processing of personal data (recorded with its source). */
  consent: boolean;
  /** Anti-spam proofs from `useLeadGuard()` (ignored in mock mode). */
  turnstileToken?: string;
  website?: string;
}

/**
 * Public lead (contact form, chatbot, demo). `DATA_SOURCE=db`: `POST /api/leads`, which
 * checks Turnstile, a honeypot and a rate limit, and never reveals whether the contact
 * already exists. `mock`: added to the in-memory CRM, as before.
 */
export async function submitLead(lead: LeadSubmission): Promise<void> {
  if (!USE_DB) {
    await createProspect({
      companyName: lead.company || lead.name,
      contactName: lead.name,
      email: lead.email,
      phone: lead.phone,
      sector: lead.sector || "Non précisé",
      city: "Abidjan",
      size: "pme",
      need: lead.need ?? "autre",
      source: lead.source === "chatbot" ? "chatbot" : "site_formulaire",
      ownerNote: lead.message,
    });
    return;
  }

  let response: Response;
  try {
    response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    });
  } catch {
    throw new ServiceError("Impossible de joindre le serveur. Vérifiez votre connexion.", "NETWORK");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ServiceError(body?.error ?? "Une erreur est survenue. Réessayez.", String(response.status));
  }
}

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
