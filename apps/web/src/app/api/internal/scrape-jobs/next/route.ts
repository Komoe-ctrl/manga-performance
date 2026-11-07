import { connection } from "next/server";
import { getEnv } from "@manga/core/env";
import { getScrape } from "@/server/scraper/instance";
import { handleNext } from "@/server/scraper/internal-api";

/** Internal (scraper only): claim the next queued job. Network-restricted and HMAC-signed. */
export async function GET(request: Request) {
  await connection();
  return handleNext(request, { scrape: getScrape(), env: getEnv() });
}
