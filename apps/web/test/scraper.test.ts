import { randomBytes } from "node:crypto";
import { bodyHash, signInternalRequest } from "@manga/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccountFlows } from "@/server/auth/account-flows";
import { createCrmService } from "@/server/crm/crm-service";
import { ScrapeError, createScrapeService } from "@/server/scraper/scrape-service";
import { handleFinish, handleNext, handleResults, type InternalDeps } from "@/server/scraper/internal-api";
import { MemoryMailer, createUser, db, resetDatabase, shutdown } from "./helpers";

const TOKEN = "b".repeat(40);
const SECRET = "c".repeat(40);
const env = { INTERNAL_API_TOKEN: TOKEN, INTERNAL_API_HMAC_SECRET: SECRET };
const NOW = new Date("2026-11-07T10:00:00Z");
let clock: Date;
let adminId: string;

const crm = () => createCrmService({ prisma: db(), flows: createAccountFlows({ prisma: db(), mailer: new MemoryMailer(), appUrl: "https://app.example.com" }), now: () => clock });
const scrape = () => createScrapeService({ prisma: db(), crm: crm(), now: () => clock });
const deps = (): InternalDeps => ({ scrape: scrape(), env, now: () => clock });

/** A request signed the way the Python service signs it. */
function signed(method: string, path: string, body = "", over: { token?: string; secret?: string; timestamp?: number; nonce?: string; signAs?: { method?: string; path?: string; body?: string } } = {}) {
  const timestamp = over.timestamp ?? Math.floor(clock.getTime() / 1000);
  const nonce = over.nonce ?? randomBytes(8).toString("hex");
  const signature = signInternalRequest({ timestamp, nonce, method: over.signAs?.method ?? method, path: over.signAs?.path ?? path, body: over.signAs?.body ?? body }, over.secret ?? SECRET);
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: { "x-internal-token": over.token ?? TOKEN, "x-timestamp": String(timestamp), "x-nonce": nonce, "x-signature": signature, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body }),
  });
}

const item = (over: Record<string, unknown> = {}) => ({
  companyName: "Hôtel Lagune SARL",
  sector: "Hôtellerie",
  city: "Abidjan",
  address: "12 rue des Cocotiers",
  phone: "07 01 02 03 04",
  email: "Contact@Lagune.ci",
  sourceUrl: "http://127.0.0.1:8765/directory/1",
  collectedAt: "2026-11-07T09:59:00Z",
  ...over,
});

async function runningJob(source = "ANNUAIRE", filters: object = {}) {
  return db().scrapeJob.create({ data: { source, filters, status: "RUNNING", startedAt: clock, createdBy: adminId } });
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ScrapeError) return error;
    throw error;
  }
  throw new Error("expected a ScrapeError");
};

beforeEach(async () => {
  await resetDatabase();
  await db().$executeRawUnsafe(`TRUNCATE TABLE "ScrapeResult", "ScrapeJob" CASCADE`);
  clock = new Date(NOW);
  adminId = (await createUser({ role: "ADMIN" })).id;
});
afterAll(shutdown);

describe("internal API authentication", () => {
  const next = (request: Request) => handleNext(request, deps());

  it("accepts a genuine signed request", async () => {
    expect((await next(signed("GET", "/api/internal/scrape-jobs/next"))).status).toBe(204);
  });

  it.each([
    ["no credentials at all", () => new Request("https://app.example.com/api/internal/scrape-jobs/next")],
    ["a wrong token", () => signed("GET", "/api/internal/scrape-jobs/next", "", { token: "x".repeat(40) })],
    ["an empty token", () => signed("GET", "/api/internal/scrape-jobs/next", "", { token: "" })],
    ["a signature made with another secret", () => signed("GET", "/api/internal/scrape-jobs/next", "", { secret: "z".repeat(40) })],
    ["a signature for another path", () => signed("GET", "/api/internal/scrape-jobs/next", "", { signAs: { path: "/api/internal/scrape-jobs/other" } })],
    ["a signature for another method", () => signed("GET", "/api/internal/scrape-jobs/next", "", { signAs: { method: "POST" } })],
    ["an old timestamp", () => signed("GET", "/api/internal/scrape-jobs/next", "", { timestamp: Math.floor(NOW.getTime() / 1000) - 301 })],
    ["a future timestamp", () => signed("GET", "/api/internal/scrape-jobs/next", "", { timestamp: Math.floor(NOW.getTime() / 1000) + 301 })],
    ["a missing nonce", () => signed("GET", "/api/internal/scrape-jobs/next", "", { nonce: "" })],
  ])("refuses %s with a bare 401", async (_label, build) => {
    const response = await next(build());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" }); // never says which check failed
  });

  it("needs both the token and the signature", async () => {
    const good = signed("GET", "/api/internal/scrape-jobs/next");
    const noSignature = new Request(good.url, { headers: { "x-internal-token": TOKEN } });
    expect((await next(noSignature)).status).toBe(401);
    const signatureOnly = new Request(good.url, { headers: Object.fromEntries([...good.headers].filter(([k]) => k !== "x-internal-token")) });
    expect((await next(signatureOnly)).status).toBe(401);
  });

  it("refuses a replayed request, but not a new one made right after", async () => {
    const first = signed("GET", "/api/internal/scrape-jobs/next", "", { nonce: "replay-nonce-0001" });
    expect((await next(first)).status).toBe(204);
    const replay = signed("GET", "/api/internal/scrape-jobs/next", "", { nonce: "replay-nonce-0001" });
    expect((await next(replay)).status).toBe(401);
    expect((await next(signed("GET", "/api/internal/scrape-jobs/next"))).status).toBe(204);
  });

  it("does not let an attacker burn a genuine signature by presenting it without the token", async () => {
    const genuine = signed("GET", "/api/internal/scrape-jobs/next", "", { nonce: "burn-attempt-0001" });
    const stolen = new Request(genuine.url, { headers: Object.fromEntries([...genuine.headers].map(([k, v]) => [k, k === "x-internal-token" ? "wrong" : v])) });
    expect((await next(stolen)).status).toBe(401);
    expect((await next(genuine)).status).toBe(204); // the real call still works
  });

  it("covers the other two endpoints too, and refuses a body that was altered in transit", async () => {
    const job = await runningJob();
    const body = JSON.stringify({ results: [item()] });
    const path = `/api/internal/scrape-jobs/${job.id}/results`;
    const tampered = signed("POST", path, JSON.stringify({ results: [item({ companyName: "Injecté" })] }), { signAs: { body } });
    expect((await handleResults(tampered, deps(), job.id)).status).toBe(401);
    expect((await handleResults(signed("POST", path, body), deps(), job.id)).status).toBe(200);
    expect((await handleFinish(signed("PATCH", `/api/internal/scrape-jobs/${job.id}`, '{"status":"DONE"}', { token: "no" }), deps(), job.id)).status).toBe(401);
    expect(await db().scrapeResult.count()).toBe(1);
  });

  it("refuses oversized bodies before doing any work", async () => {
    const job = await runningJob();
    const huge = "x".repeat(1_100_000);
    expect((await handleResults(signed("POST", `/api/internal/scrape-jobs/${job.id}/results`, huge), deps(), job.id)).status).toBe(413);
    expect(bodyHash(huge)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("claiming jobs", () => {
  async function queued(count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const row = await db().scrapeJob.create({ data: { source: "ANNUAIRE", filters: { city: `Ville ${i}` }, status: "QUEUED", createdBy: adminId, createdAt: new Date(NOW.getTime() + i * 1000) } });
      ids.push(row.id);
    }
    return ids;
  }

  it("hands out the oldest queued job first, marked RUNNING, with its filters", async () => {
    const [first, second] = await queued(2);
    const claimed = await scrape().claimNext();
    expect(claimed).toEqual({ id: first, source: "ANNUAIRE", filters: { city: "Ville 0" } });
    expect(await db().scrapeJob.findUniqueOrThrow({ where: { id: first! } })).toMatchObject({ status: "RUNNING", startedAt: clock });
    expect((await scrape().claimNext())?.id).toBe(second);
    expect(await scrape().claimNext()).toBeNull();
  });

  it("never gives the same job to two scrapers at once", async () => {
    const ids = await queued(5);
    const claims = await Promise.all(Array.from({ length: 12 }, () => scrape().claimNext()));
    const got = claims.filter((c) => c !== null).map((c) => c!.id);
    expect(got.sort()).toEqual([...ids].sort());
    expect(new Set(got).size).toBe(5);
  });

  it("fails a job whose scraper disappeared, so it does not hang forever", async () => {
    const stale = await db().scrapeJob.create({ data: { source: "ANNUAIRE", filters: {}, status: "RUNNING", startedAt: new Date(NOW.getTime() - 3 * 3600_000), createdBy: adminId } });
    const fresh = await db().scrapeJob.create({ data: { source: "ANNUAIRE", filters: {}, status: "RUNNING", startedAt: new Date(NOW.getTime() - 3600_000), createdBy: adminId } });
    await scrape().claimNext();
    expect(await db().scrapeJob.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: "FAILED", error: expect.stringContaining("Délai dépassé") });
    expect((await db().scrapeJob.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("RUNNING");
  });

  it("answers 204 through the endpoint when there is nothing to do, and the job otherwise", async () => {
    expect((await handleNext(signed("GET", "/api/internal/scrape-jobs/next"), deps())).status).toBe(204);
    const [id] = await queued(1);
    const response = await handleNext(signed("GET", "/api/internal/scrape-jobs/next"), deps());
    expect(await response.json()).toEqual({ job: { id, source: "ANNUAIRE", filters: { city: "Ville 0" } } });
  });
});

describe("receiving results", () => {
  it("normalises and stores a result, and counts it", async () => {
    const job = await runningJob();
    expect(await scrape().acceptResults(job.id, [item()])).toEqual({ accepted: 1, duplicates: 0, invalid: 0, limitReached: false });
    expect(await db().scrapeResult.findFirstOrThrow()).toMatchObject({
      companyName: "Hôtel Lagune SARL",
      companyNameNorm: "hotel lagune",
      email: "contact@lagune.ci",
      phone: "+2250701020304",
      sourceUrl: "http://127.0.0.1:8765/directory/1",
      duplicateOfProspectId: null,
    });
    expect((await db().scrapeJob.findUniqueOrThrow({ where: { id: job.id } })).resultsCount).toBe(1);
  });

  it("validates each item on its own: one bad row never loses the batch", async () => {
    const job = await runningJob();
    const outcome = await scrape().acceptResults(job.id, [
      item({ companyName: "Société Un" , email: "un@x.ci", phone: undefined }),
      { companyName: "" },
      item({ companyName: "Deux", sourceUrl: "javascript:alert(1)" }),
      item({ companyName: "Trois", sourceUrl: "ftp://example.com/x" }),
      item({ companyName: "Quatre", collectedAt: "yesterday" }),
      item({ companyName: "SARL" }), // nothing left once the legal form is removed
      "not an object",
      null,
      item({ companyName: "Cinq", email: "cinq@x.ci", phone: undefined }),
    ]);
    expect(outcome).toMatchObject({ accepted: 2, invalid: 7 });
    expect((await db().scrapeResult.findMany()).map((r) => r.companyName).sort()).toEqual(["Cinq", "Société Un"]);
  });

  it("drops unusable contact details instead of trusting them", async () => {
    const job = await runningJob();
    await scrape().acceptResults(job.id, [item({ email: "not-an-email", phone: "12" })]);
    expect(await db().scrapeResult.findFirstOrThrow()).toMatchObject({ email: null, phone: null });
  });

  it.each([
    ["the same email", { companyName: "Tout Autre Nom", phone: "05 55 55 55 55", email: "CONTACT@lagune.ci" }],
    ["the same phone, written differently", { companyName: "Tout Autre Nom", email: "x@y.ci", phone: "+225 0701020304" }],
    ["a very similar name", { companyName: "HOTEL LAGUNES S.A.", email: "x@y.ci", phone: "05 55 55 55 55" }],
  ])("skips a second result with %s in the same job", async (_label, other) => {
    const job = await runningJob();
    await scrape().acceptResults(job.id, [item()]);
    expect(await scrape().acceptResults(job.id, [item(other)])).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(await db().scrapeResult.count()).toBe(1);
  });

  it("skips duplicates inside one batch, and repeated batches (a scraper retry)", async () => {
    const job = await runningJob();
    expect(await scrape().acceptResults(job.id, [item(), item()])).toMatchObject({ accepted: 1, duplicates: 1 });
    expect(await scrape().acceptResults(job.id, [item()])).toMatchObject({ accepted: 0, duplicates: 1 });
    expect((await db().scrapeJob.findUniqueOrThrow({ where: { id: job.id } })).resultsCount).toBe(1);
  });

  it("does not compare with the results of another job", async () => {
    const [a, b] = [await runningJob(), await runningJob()];
    await scrape().acceptResults(a.id, [item()]);
    expect(await scrape().acceptResults(b.id, [item()])).toMatchObject({ accepted: 1, duplicates: 0 });
  });

  it("keeps, but flags, a company that already exists in the CRM", async () => {
    const existing = await crm().createProspect({ companyName: "Hôtel Lagune", sector: "Hôtellerie", email: "awa@lagune.ci", phone: "07 01 02 03 04", source: "manuel" }, adminId);
    const job = await runningJob();
    // Matches by phone, by name, and by email: three different ways to be known.
    await scrape().acceptResults(job.id, [
      item({ companyName: "Autre", email: "a@a.ci" }),
      item({ companyName: "Hôtel Lagune", email: "b@b.ci", phone: "05 00 00 00 01" }),
      item({ companyName: "Zèbre Conseil", email: "AWA@lagune.ci", phone: "05 00 00 00 02" }),
      item({ companyName: "Baobab Construction", email: "new@baobab.ci", phone: "05 00 00 00 03" }),
    ]);
    const flagged = (await db().scrapeResult.findMany({ where: { duplicateOfProspectId: existing.id } })).map((r) => r.companyName).sort();
    expect(flagged).toEqual(["Autre", "Hôtel Lagune", "Zèbre Conseil"]);
    expect((await scrape().listResults(job.id)).filter((r) => r.duplicateOf === existing.id)).toHaveLength(3);
  });

  it("refuses results for unknown or closed jobs", async () => {
    expect((await failure(scrape().acceptResults("nope", [item()]))).code).toBe("NOT_FOUND");
    for (const status of ["QUEUED", "DONE", "FAILED"]) {
      const job = await db().scrapeJob.create({ data: { source: "ANNUAIRE", filters: {}, status, createdBy: adminId } });
      expect((await failure(scrape().acceptResults(job.id, [item()]))).code).toBe("CONFLICT");
    }
  });

  it("stops at 5000 results per job and says so", async () => {
    const job = await db().scrapeJob.create({ data: { source: "ANNUAIRE", filters: {}, status: "RUNNING", createdBy: adminId, resultsCount: 4999 } });
    const outcome = await scrape().acceptResults(job.id, [item({ companyName: "Un de plus", email: "plus@x.ci" }), item({ companyName: "Un de trop", email: "trop@x.ci", phone: "05 00 00 00 09" })]);
    expect(outcome).toMatchObject({ accepted: 1, limitReached: true });
  });

  it("answers through the endpoint, and refuses malformed batches", async () => {
    const job = await runningJob();
    const path = `/api/internal/scrape-jobs/${job.id}/results`;
    const ok = await handleResults(signed("POST", path, JSON.stringify({ results: [item(), { companyName: "" }] })), deps(), job.id);
    expect(await ok.json()).toEqual({ accepted: 1, duplicates: 0, invalid: 1, limitReached: false });

    for (const body of ["not json", "{}", '{"results":[]}', JSON.stringify({ results: Array.from({ length: 101 }, () => item()) }), JSON.stringify({ results: [item()], extra: 1 })]) {
      expect((await handleResults(signed("POST", path, body), deps(), job.id)).status).toBe(400);
    }
    expect((await handleResults(signed("POST", "/api/internal/scrape-jobs/nope/results", JSON.stringify({ results: [item()] })), deps(), "nope")).status).toBe(404);
  });
});

describe("closing a job", () => {
  const finish = (id: string, body: object) => handleFinish(signed("PATCH", `/api/internal/scrape-jobs/${id}`, JSON.stringify(body)), deps(), id);

  it("closes as DONE with the server's own count, whatever the scraper claims", async () => {
    const job = await runningJob();
    await scrape().acceptResults(job.id, [item(), item({ companyName: "Autre Société", email: "o@o.ci", phone: "05 00 00 00 05" })]);
    const response = await finish(job.id, { status: "DONE", resultsCount: 999 }).catch(() => null);
    expect(response?.status).toBe(400); // strict: the scraper cannot claim a count at all
    const ok = await finish(job.id, { status: "DONE" });
    expect(await ok.json()).toEqual({ id: job.id, status: "termine", resultsCount: 2 });
    expect(await db().scrapeJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "DONE", finishedAt: clock, error: null });
  });

  it("records a failure, truncated", async () => {
    const job = await runningJob();
    expect((await finish(job.id, { status: "FAILED", error: "x".repeat(900) })).status).toBe(200);
    const row = await db().scrapeJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("FAILED");
    expect(row.error).toHaveLength(500);
    expect((await finish(job.id, { status: "FAILED", error: "x".repeat(2000) })).status).toBe(400); // over the schema limit
  });

  it("is harmless to repeat, but refuses to change a closed outcome", async () => {
    const job = await runningJob();
    expect((await finish(job.id, { status: "DONE" })).status).toBe(200);
    expect((await finish(job.id, { status: "DONE" })).status).toBe(200);
    expect((await finish(job.id, { status: "FAILED" })).status).toBe(409);
    expect((await finish("nope", { status: "DONE" })).status).toBe(404);
    expect((await finish(job.id, { status: "MAYBE" })).status).toBe(400);
  });

  it("stops accepting results once closed", async () => {
    const job = await runningJob();
    await finish(job.id, { status: "DONE" });
    expect((await handleResults(signed("POST", `/api/internal/scrape-jobs/${job.id}/results`, JSON.stringify({ results: [item()] })), deps(), job.id)).status).toBe(409);
  });
});

describe("admin side", () => {
  it("creates a queued job and lists it in the front's shape", async () => {
    const job = await scrape().createJob({ source: "annuaire", filters: { sector: "Hôtellerie", city: "Abidjan", size: "pme" } }, adminId);
    expect(job).toMatchObject({ source: "annuaire", status: "en_cours", filters: { sector: "Hôtellerie", city: "Abidjan", size: "pme" }, resultsCount: 0 });
    expect(await db().scrapeJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "QUEUED", source: "ANNUAIRE", createdBy: adminId });
    expect(await db().auditLog.count({ where: { action: "scrape.job_created", entityId: job.id } })).toBe(1);
    expect((await scrape().listJobs()).map((j) => j.id)).toEqual([job.id]);
    expect((await scrape().getJob(job.id))?.id).toBe(job.id);
    expect(await scrape().getJob("nope")).toBeNull();
  });

  it("maps every status for the screens", async () => {
    const row = (status: string) => db().scrapeJob.create({ data: { source: "SITE_WEB", filters: {}, status, createdBy: adminId } });
    const [q, r, d, f] = await Promise.all(["QUEUED", "RUNNING", "DONE", "FAILED"].map(row));
    const byId = Object.fromEntries((await scrape().listJobs()).map((j) => [j.id, j.status]));
    expect([byId[q!.id], byId[r!.id], byId[d!.id], byId[f!.id]]).toEqual(["en_cours", "en_cours", "termine", "echec"]);
  });

  it.each([
    [{ source: "linkedin", filters: {} }],
    [{ source: "annuaire" }],
    [{ source: "annuaire", filters: { size: "geant" } }],
    [{ source: "annuaire", filters: {}, extra: 1 }],
    ["nope"],
  ])("refuses invalid parameters %j", async (input) => {
    expect((await failure(scrape().createJob(input, adminId))).code).toBe("INVALID");
    expect(await db().scrapeJob.count()).toBe(0);
  });
});

describe("importing into the CRM", () => {
  async function collected(items: Record<string, unknown>[]) {
    const job = await runningJob("ANNUAIRE", {});
    await scrape().acceptResults(job.id, items);
    return { job, results: await db().scrapeResult.findMany({ where: { jobId: job.id }, orderBy: { companyName: "asc" } }) };
  }

  it("creates prospects of source SCRAPER, with their origin, and links the results", async () => {
    const { results } = await collected([item(), item({ companyName: "Baobab Construction", email: "b@baobab.ci", phone: "05 00 00 00 03", sector: undefined, city: undefined })]);
    expect(await scrape().importResults(results.map((r) => r.id), adminId)).toEqual({ imported: 2, skipped: 0 });

    const prospect = await db().prospect.findFirstOrThrow({ where: { companyName: "Hôtel Lagune SARL" } });
    expect(prospect).toMatchObject({ source: "SCRAPER", status: "NOUVEAU", sector: "Hôtellerie", city: "Abidjan", email: "contact@lagune.ci", phone: "+2250701020304", notes: "Collecté depuis http://127.0.0.1:8765/directory/1" });
    expect(prospect.consentAt).toBeNull(); // no consent: this is public professional data, compliance is the client's to confirm
    expect((await db().prospect.findFirstOrThrow({ where: { companyName: "Baobab Construction" } })).sector).toBe("Non précisé");
    expect((await db().scrapeResult.findMany()).every((r) => r.importedProspectId !== null)).toBe(true);
    expect((await scrape().listResults(results[0]!.jobId)).every((r) => r.importedToCrm)).toBe(true);
    expect(await db().followUp.count()).toBeGreaterThan(0);
    expect(await db().auditLog.count({ where: { action: "scrape.imported" } })).toBe(1);
  });

  it("never starts an email sequence for imported prospects", async () => {
    const sequence = await db().emailSequence.create({ data: { name: "Bienvenue", trigger: "NEWSLETTER_SIGNUP", active: true } });
    await db().sequenceStep.create({ data: { sequenceId: sequence.id, order: 1, delayDays: 0, subject: "x", bodyJson: { type: "doc", content: [] } } });
    const { results } = await collected([item()]);
    await scrape().importResults(results.map((r) => r.id), adminId);
    expect(await db().sequenceEnrollment.count()).toBe(0);
  });

  it("skips duplicates of the CRM, results already imported, repeats, and unknown ids", async () => {
    await crm().createProspect({ companyName: "Déjà là", sector: "x", email: "deja@la.ci", source: "manuel" }, adminId);
    const { results } = await collected([item({ companyName: "Déjà là SARL", email: "deja@la.ci", phone: undefined }), item({ companyName: "Nouvelle Société", email: "n@n.ci", phone: "05 00 00 00 07" })]);
    const ids = results.map((r) => r.id);

    expect(await scrape().importResults([...ids, ...ids, "unknown-id"], adminId)).toEqual({ imported: 1, skipped: 2 });
    expect(await scrape().importResults(ids, adminId)).toEqual({ imported: 0, skipped: 2 }); // second time
    expect(await db().prospect.count()).toBe(2);
  });

  it("notices a prospect created since the collection, flags the result, and imports nothing", async () => {
    const { results } = await collected([item()]);
    const created = await crm().createProspect({ companyName: "Hôtel Lagune", sector: "Hôtellerie", email: "contact@lagune.ci", source: "manuel" }, adminId);
    expect(await scrape().importResults([results[0]!.id], adminId)).toEqual({ imported: 0, skipped: 1 });
    expect((await db().scrapeResult.findUniqueOrThrow({ where: { id: results[0]!.id } })).duplicateOfProspectId).toBe(created.id);
    expect(await db().prospect.count()).toBe(1);
  });

  it("does not import results flagged as CRM duplicates at collection time", async () => {
    const existing = await crm().createProspect({ companyName: "Hôtel Lagune", sector: "x", email: "contact@lagune.ci", source: "manuel" }, adminId);
    const { results } = await collected([item()]);
    expect(results[0]!.duplicateOfProspectId).toBe(existing.id);
    expect(await scrape().importResults([results[0]!.id], adminId)).toEqual({ imported: 0, skipped: 1 });
  });
});
