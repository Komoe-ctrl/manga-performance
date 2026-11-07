import * as privacy from "@/server/actions/privacy";
import { USE_DB, unwrap } from "./data-source";
import { db, latency } from "./store";

/** Everything held about a contact, as a JSON document (loi 2013-450: right of access). */
export const exportContactData = (prospectId: string): Promise<Record<string, unknown>> =>
  USE_DB
    ? unwrap(privacy.exportContactDataAction(prospectId))
    : latency(() => {
        const prospect = db.prospects.find((p) => p.id === prospectId);
        if (!prospect) throw new Error("Contact introuvable.");
        return {
          exportedAt: new Date().toISOString(),
          contact: prospect,
          interactions: db.interactions.filter((i) => i.prospectId === prospectId),
          followUps: db.followUps.filter((f) => f.prospectId === prospectId),
        };
      });

/** Irreversible. Invoices are kept for accounting purposes. */
export const anonymizeContact = (prospectId: string): Promise<{ invoicesKept: number }> =>
  USE_DB
    ? unwrap(privacy.anonymizeContactAction({ id: prospectId, confirm: true }))
    : latency(() => {
        const index = db.prospects.findIndex((p) => p.id === prospectId);
        if (index === -1) throw new Error("Contact introuvable.");
        db.prospects[index] = {
          ...db.prospects[index],
          companyName: "Contact anonymisé",
          contactName: "",
          email: undefined,
          phone: undefined,
          city: "",
          ownerNote: undefined,
        };
        for (const interaction of db.interactions) if (interaction.prospectId === prospectId) interaction.summary = "[supprimé]";
        return { invoicesKept: db.invoices.filter((i) => i.clientId === prospectId).length };
      });
