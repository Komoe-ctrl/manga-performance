import { getEnv } from "@manga/core/env";
import { getScrape } from "@/server/scraper/instance";
import { handleResults } from "@/server/scraper/internal-api";

/** Internal (scraper only): push a batch of results. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleResults(request, { scrape: getScrape(), env: getEnv() }, id);
}
