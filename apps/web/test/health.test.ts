import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { db, resetDatabase, shutdown } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => undefined }));

beforeEach(resetDatabase);
afterAll(shutdown);

const beat = (at: Date) =>
  db().setting.upsert({ where: { key: "worker.heartbeat" }, create: { key: "worker.heartbeat", value: { at: at.toISOString() } }, update: { value: { at: at.toISOString() } } });

describe("GET /api/health", () => {
  it("is ok when the database answers and the worker has a fresh heartbeat", async () => {
    await beat(new Date());
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "up", worker: "up" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is degraded when the worker never reported", async () => {
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "degraded", database: "up", worker: "down" });
  });

  it("is degraded when the heartbeat is stale", async () => {
    await beat(new Date(Date.now() - 5 * 60 * 1000));
    expect((await GET()).status).toBe(503);
  });
});
