import { db, latency } from "./store";

export type Settings = typeof db.settings;

export const getSettings = () => latency(() => structuredClone(db.settings));

// TODO: à confirmer par le client — relances CRM : rappel interne uniquement, ou aussi email automatique au prospect ?
export const saveSettings = (settings: Settings) =>
  latency(() => {
    db.settings = structuredClone(settings);
    return db.settings;
  });
