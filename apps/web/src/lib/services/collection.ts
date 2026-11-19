import {
  buildCollectionPeriods,
  collectionClients,
  collectionEntities,
  collectionMonths,
  collectionPlans,
  collectionTemplates,
} from "@/lib/mock/collection";
import type { CollectionOverview } from "@/lib/types/collection";
import { latency } from "./store";

/**
 * Tableau de suivi (entités × périodes). Mock uniquement pour l'instant : le branchement base de
 * données arrive avec l'étape B7 de l'avenant.
 */
export const getCollectionOverview = (): Promise<CollectionOverview> =>
  latency(() => {
    const periods = buildCollectionPeriods();
    return {
      clients: collectionClients,
      months: collectionMonths,
      rows: collectionPlans.map((plan) => {
        const entity = collectionEntities.find((e) => e.id === plan.entityId)!;
        return {
          plan,
          entity,
          client: collectionClients.find((c) => c.id === entity.clientId)!,
          template: collectionTemplates.find((t) => t.id === plan.templateId)!,
          periods: periods.filter((p) => p.planId === plan.id),
        };
      }),
    };
  });
