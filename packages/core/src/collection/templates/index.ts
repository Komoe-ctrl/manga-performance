import type { CollectionSector, TemplateDef } from "../types";
import { btpChantiers } from "./btp";
import { commerceMensuel } from "./commerce";
import { hotelConsommablesCpro } from "./hotel-consumables";
import { hotelMensuel } from "./hotel";
import { restoMensuel } from "./restaurant";
import { techMensuel } from "./tech";

export { HOTEL_CPRO_SHEET, HOTEL_POPULATION_SHEET } from "./hotel-consumables";
export { btpChantiers, commerceMensuel, hotelConsommablesCpro, hotelMensuel, restoMensuel, techMensuel };

/** Tous les modèles de la V1, un fichier par secteur (avenant §4). */
export const TEMPLATES: readonly TemplateDef[] = [hotelMensuel, hotelConsommablesCpro, restoMensuel, commerceMensuel, btpChantiers, techMensuel];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templatesForSector(sector: CollectionSector): TemplateDef[] {
  return TEMPLATES.filter((t) => t.sector === sector);
}
