import * as crm from "@/server/actions/crm";
import { USE_DB, unwrap } from "./data-source";
import { db, latency } from "./store";

export type Settings = typeof db.settings;

export const getSettings = (): Promise<Settings> =>
  USE_DB ? unwrap(crm.getSettingsAction()) : latency(() => structuredClone(db.settings));

// TODO: à confirmer par le client — relances CRM : rappel interne uniquement, ou aussi email automatique au prospect ?
export const saveSettings = (settings: Settings): Promise<Settings> =>
  USE_DB
    ? unwrap(crm.saveSettingsAction(settings))
    : latency(() => {
        db.settings = structuredClone(settings);
        return db.settings;
      });
