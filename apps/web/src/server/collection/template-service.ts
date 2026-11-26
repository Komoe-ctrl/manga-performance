import { buildTemplateWorkbook, getTemplate } from "@manga/core/collection";
import { CPRA_TEMPLATE_ID, cpraTemplateOptions } from "@manga/db/cpra";
import { usaliMapping } from "@manga/db/usali";
import { format } from "date-fns";
import type { PrismaClient } from "@manga/db";
import { DomainError } from "../domain-error";
import { assertCanDeposit, assertEntityInScope, type CollectionActor } from "./scope";

export function createTemplateService(deps: { prisma: PrismaClient; secret: string }) {
  const { prisma, secret } = deps;

  return {
    /**
     * Excel à remplir pour une période (avenant §5). Passe par `entityScope` : une période hors du
     * périmètre répond comme une période inexistante. L'analyste, en lecture seule, ne dépose pas.
     */
    async buildForPeriod(actor: CollectionActor, periodId: string): Promise<{ buffer: Buffer; filename: string }> {
      const period = await prisma.collectionPeriod.findUnique({
        where: { id: periodId },
        select: { id: true, periodStart: true, periodEnd: true, dueAt: true, plan: { select: { templateId: true, entity: { select: { id: true, name: true, clientId: true } } } } },
      });
      if (!period) throw new DomainError("NOT_FOUND", "Période introuvable.");
      await assertEntityInScope(prisma, actor, period.plan.entity.id);
      assertCanDeposit(actor);

      const template = getTemplate(period.plan.templateId);
      if (!template) throw new DomainError("NOT_FOUND", "Modèle de collecte inconnu.");

      const buffer = await buildTemplateWorkbook({
        template,
        entity: period.plan.entity,
        options: period.plan.templateId === CPRA_TEMPLATE_ID ? await cpraTemplateOptions(prisma, period.plan.entity.clientId) : undefined,
        reference: period.plan.templateId === "hotel_mensuel" ? { usali: usaliMapping } : undefined,
        period: { id: period.id, start: period.periodStart, end: period.periodEnd, dueAt: period.dueAt },
        secret,
      });
      const slug = period.plan.entity.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
      return { buffer, filename: `${template.id}_${slug}_${format(period.periodStart, "yyyy-MM")}.xlsx` };
    },
  };
}
