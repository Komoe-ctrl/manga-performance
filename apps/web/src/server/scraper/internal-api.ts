import { createLogger, safeEqualStrings, verifyInternalSignature } from "@manga/core";
import { scrapeBatchSchema, scrapeFinishSchema } from "@manga/validation";
import { LIMITS, RateLimitError, consume } from "../auth/rate-limit";
import { DomainError } from "../domain-error";
import type { ScrapeService } from "./scrape-service";

const logger = createLogger({ service: "web" });
const MAX_BODY_BYTES = 1_000_000;

export interface InternalDeps {
  scrape: ScrapeService;
  env: { INTERNAL_API_TOKEN: string; INTERNAL_API_HMAC_SECRET: string };
  now?: () => Date;
  /** Injected in tests. */
  rateLimit?: typeof consume;
}

const unauthorized = () => Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

/**
 * Authenticates a scraper request (spec, 6.10): the shared token, then the HMAC of the
 * request with its timestamp window, then replay detection. Every failure looks the same
 * from outside (401); the reason is only logged. Returns `null` when the request is genuine.
 *
 * These endpoints are also meant to be unreachable from the Internet (Caddy restricts them
 * to the Docker network); this check is the second lock.
 */
async function authenticate(request: Request, body: string, deps: InternalDeps): Promise<Response | null> {
  const token = request.headers.get("x-internal-token") ?? "";
  if (!safeEqualStrings(token, deps.env.INTERNAL_API_TOKEN)) {
    logger.warn({ reason: "BAD_TOKEN" }, "internal request refused");
    return unauthorized();
  }

  const url = new URL(request.url);
  const signature = request.headers.get("x-signature")?.replace(/^sha256=/i, "") ?? null;
  const check = verifyInternalSignature(
    {
      timestamp: request.headers.get("x-timestamp"),
      nonce: request.headers.get("x-nonce") ?? "",
      method: request.method,
      path: url.pathname + url.search,
      body,
      signature,
    },
    deps.env.INTERNAL_API_HMAC_SECRET,
    deps.now?.(),
  );
  if (!check.ok) {
    logger.warn({ reason: check.reason }, "internal request refused");
    return unauthorized();
  }

  // Each signature is accepted once. Last, so unauthenticated calls cannot fill the table.
  try {
    await (deps.rateLimit ?? consume)(LIMITS.internalReplay, signature!);
  } catch (error) {
    if (error instanceof RateLimitError) {
      logger.warn({ reason: "REPLAY" }, "internal request refused");
      return unauthorized();
    }
    throw error;
  }
  return null;
}

async function readBody(request: Request): Promise<{ body: string } | { response: Response }> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { response: Response.json({ error: "TOO_LARGE" }, { status: 413 }) };
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return { response: Response.json({ error: "TOO_LARGE" }, { status: 413 }) };
  return { body };
}

function failure(error: unknown): Response {
  if (error instanceof DomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  logger.error({ errorName: error instanceof Error ? error.name : "unknown" }, "internal API failure");
  return Response.json({ error: "INTERNAL" }, { status: 500 });
}

/** `GET /api/internal/scrape-jobs/next`: the oldest queued job (now RUNNING), or 204. */
export async function handleNext(request: Request, deps: InternalDeps): Promise<Response> {
  const read = await readBody(request);
  if ("response" in read) return read.response;
  const denied = await authenticate(request, read.body, deps);
  if (denied) return denied;
  try {
    const job = await deps.scrape.claimNext();
    return job ? Response.json({ job }) : new Response(null, { status: 204 });
  } catch (error) {
    return failure(error);
  }
}

/** `POST /api/internal/scrape-jobs/:id/results`: a batch of up to 100 results. */
export async function handleResults(request: Request, deps: InternalDeps, jobId: string): Promise<Response> {
  const read = await readBody(request);
  if ("response" in read) return read.response;
  const denied = await authenticate(request, read.body, deps);
  if (denied) return denied;

  let json: unknown;
  try {
    json = JSON.parse(read.body);
  } catch {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  const batch = scrapeBatchSchema.safeParse(json);
  if (!batch.success) return Response.json({ error: "INVALID" }, { status: 400 });
  try {
    return Response.json(await deps.scrape.acceptResults(jobId, batch.data.results));
  } catch (error) {
    return failure(error);
  }
}

/** `PATCH /api/internal/scrape-jobs/:id`: close the job as DONE or FAILED. */
export async function handleFinish(request: Request, deps: InternalDeps, jobId: string): Promise<Response> {
  const read = await readBody(request);
  if ("response" in read) return read.response;
  const denied = await authenticate(request, read.body, deps);
  if (denied) return denied;

  let json: unknown;
  try {
    json = JSON.parse(read.body);
  } catch {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  const parsed = scrapeFinishSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "INVALID" }, { status: 400 });
  try {
    const job = await deps.scrape.finish(jobId, parsed.data);
    return Response.json({ id: job.id, status: job.status, resultsCount: job.resultsCount });
  } catch (error) {
    return failure(error);
  }
}
