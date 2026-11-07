import { connection } from "next/server";
import { getPrisma } from "@/server/db";

/** The worker writes its heartbeat every 30 s; older than this means it is down. */
const WORKER_STALE_MS = 2 * 60 * 1000;

/**
 * Liveness for the load balancer and the monitoring (spec, section 12): database and worker.
 * Public on purpose and minimal: it says up or down, never versions, hosts or errors.
 */
export async function GET() {
  await connection();
  const prisma = getPrisma();
  let database = false;
  let worker = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
    const beat = await prisma.setting.findUnique({ where: { key: "worker.heartbeat" } });
    const at = typeof beat?.value === "object" && beat.value && "at" in beat.value ? Date.parse(String(beat.value.at)) : NaN;
    worker = Number.isFinite(at) && Date.now() - at < WORKER_STALE_MS;
  } catch {
    // reported below as down; the error itself is not exposed
  }
  const ok = database && worker;
  return Response.json(
    { status: ok ? "ok" : "degraded", database: database ? "up" : "down", worker: worker ? "up" : "down" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
