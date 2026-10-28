import { db, latency } from "./store";

export const listScrapeJobs = () => latency(() => [...db.scrapeJobs]);
export const getScrapeJob = (id: string) =>
  latency(() => db.scrapeJobs.find((j) => j.id === id) ?? null);
export const listScrapeResults = (jobId: string) =>
  latency(() => db.scrapeResults.filter((r) => r.jobId === jobId));
