import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/server/security/turnstile";

const answer = (body: unknown, init?: ResponseInit) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, ...init }));

describe("verifyTurnstile", () => {
  it("accepts a successful verification and sends the secret, token and IP", async () => {
    const fetchImpl = answer({ success: true });
    expect(await verifyTurnstile({ secret: "s3cret", token: "tok", ip: "203.0.113.5", fetchImpl })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("s3cret");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("203.0.113.5");
  });

  it("omits the IP when it is unknown", async () => {
    const fetchImpl = answer({ success: true });
    await verifyTurnstile({ secret: "s", token: "t", ip: "unknown", fetchImpl });
    expect(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).has("remoteip")).toBe(false);
  });

  it("rejects when Cloudflare says no", async () => {
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: answer({ success: false }) })).toBe(false);
  });

  it("rejects a missing token without calling Cloudflare", async () => {
    const fetchImpl = answer({ success: true });
    expect(await verifyTurnstile({ secret: "s", token: undefined, fetchImpl })).toBe(false);
    expect(await verifyTurnstile({ secret: "s", token: "", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on HTTP errors, malformed answers and network failures", async () => {
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: answer({}, { status: 500 }) })).toBe(false);
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: answer({ success: "yes" }) })).toBe(false);
    const boom = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: boom })).toBe(false);
  });
});
