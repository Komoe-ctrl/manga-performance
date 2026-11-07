import { getEnv } from "@manga/core/env";
import { getScrape } from "@/server/scraper/instance";
import { handleFinish } from "@/server/scraper/internal-api";

/** Internal (scraper only): close the job. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleFinish(request, { scrape: getScrape(), env: getEnv() }, id);
}
