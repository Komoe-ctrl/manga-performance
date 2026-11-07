import { getCrm } from "../crm/instance";
import { getPrisma } from "../db";
import { createScrapeService, type ScrapeService } from "./scrape-service";

export function getScrape(): ScrapeService {
  return createScrapeService({ prisma: getPrisma(), crm: getCrm() });
}
