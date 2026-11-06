import type { ScrapeJob, ScrapeResult } from "@/lib/types";
import { SECTORS } from "@/lib/constants";
import { db, latency, nextId } from "./store";

export const SCRAPE_DURATION_MS = 4000;

export const listScrapeJobs = () => latency(() => [...db.scrapeJobs]);
export const getScrapeJob = (id: string) =>
  latency(() => db.scrapeJobs.find((j) => j.id === id) ?? null);
export const listScrapeResults = (jobId: string) =>
  latency(() => db.scrapeResults.filter((r) => r.jobId === jobId));

const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

function generateResults(job: ScrapeJob): ScrapeResult[] {
  const count = 20 + Math.floor(Math.random() * 20);
  const known = db.prospects;
  return Array.from({ length: count }, (_, i) => {
    const dup = Math.random() < 0.1 ? pick(known) : undefined;
    const city = job.filters.city?.split(" - ").pop() ?? pick(["Abidjan", "Bouaké", "San-Pédro", "Yamoussoukro"]);
    return {
      id: `${job.id}-r${i + 1}`,
      jobId: job.id,
      companyName: dup?.companyName ?? `${pick(["Établissements", "Groupe", "Société"])} ${pick(["Akissi", "Bamba", "Soro", "Tano", "Kacou", "Diallo"])} ${i + 1}`,
      sector: job.filters.sector ?? pick(SECTORS),
      address: Math.random() > 0.2 ? `${1 + Math.floor(Math.random() * 80)} rue ${1 + Math.floor(Math.random() * 40)}, ${city}` : undefined,
      phone: Math.random() > 0.3 ? `+225 07 ${[0, 0, 0, 0].map(() => String(Math.floor(Math.random() * 100)).padStart(2, "0")).join(" ")}` : undefined,
      email: Math.random() > 0.5 ? `info${i + 1}@exemple-${job.id}.example` : undefined,
      importedToCrm: false,
      duplicateOf: dup?.id,
    };
  });
}

/** Lance un job simulé : il passe à « terminé » après SCRAPE_DURATION_MS, même si l'écran est quitté. */
export const createScrapeJob = (source: ScrapeJob["source"], filters: ScrapeJob["filters"]) =>
  latency(() => {
    const job: ScrapeJob = {
      id: nextId("job"),
      source,
      filters,
      status: "en_cours",
      startedAt: new Date().toISOString(),
      resultsCount: 0,
    };
    db.scrapeJobs.unshift(job);
    setTimeout(() => {
      const results = generateResults(job);
      db.scrapeResults.push(...results);
      job.resultsCount = results.length;
      job.status = "termine";
    }, SCRAPE_DURATION_MS);
    return job;
  });

/** Importe les résultats dans le CRM (source « scraper ») ; ignore doublons et déjà importés. */
export const importScrapeResults = (ids: string[]) =>
  latency(() => {
    let imported = 0;
    let skipped = 0;
    for (const id of ids) {
      const r = db.scrapeResults.find((x) => x.id === id);
      if (!r || r.importedToCrm || r.duplicateOf) {
        skipped++;
        continue;
      }
      const job = db.scrapeJobs.find((j) => j.id === r.jobId);
      db.prospects.unshift({
        id: nextId("p"),
        companyName: r.companyName,
        contactName: "À identifier",
        email: r.email,
        phone: r.phone,
        sector: r.sector,
        city: r.address?.split(", ").pop() ?? job?.filters.city ?? "Abidjan",
        size: job?.filters.size ?? "pme",
        need: "autre",
        status: "nouveau",
        source: "scraper",
        createdAt: new Date().toISOString(),
      });
      r.importedToCrm = true;
      imported++;
    }
    return { imported, skipped };
  });
