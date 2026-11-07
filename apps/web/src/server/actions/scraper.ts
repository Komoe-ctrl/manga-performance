"use server";

import { z } from "zod";
import { getScrape } from "../scraper/instance";
import { parseInput, runAdmin } from "./result";

const idSchema = z.string().min(1).max(64);

// Every action goes through `runAdmin`: `requireAdmin()` first (spec, section 5).

export async function createScrapeJobAction(input: unknown) {
  return runAdmin((admin) => getScrape().createJob(input, admin.userId));
}

export async function listScrapeJobsAction() {
  return runAdmin(() => getScrape().listJobs());
}

export async function getScrapeJobAction(id: unknown) {
  return runAdmin(() => getScrape().getJob(parseInput(idSchema, id)));
}

export async function listScrapeResultsAction(jobId: unknown) {
  return runAdmin(() => getScrape().listResults(parseInput(idSchema, jobId)));
}

export async function importScrapeResultsAction(ids: unknown) {
  return runAdmin((admin) => getScrape().importResults(parseInput(z.array(idSchema).max(1000), ids), admin.userId));
}
