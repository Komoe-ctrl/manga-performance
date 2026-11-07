import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTERNAL_TOLERANCE_SECONDS,
  bodyHash,
  signInternalRequest,
  verifyInternalSignature,
} from "../src/internal-api";

interface Vector {
  name: string;
  secret: string;
  timestamp: number;
  nonce: string;
  method: string;
  path: string;
  body: string;
  signature: string;
}

// Shared with the Python service: both sides must produce exactly these signatures.
const vectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../apps/scraper/tests/fixtures/signing-vectors.json"), "utf8"),
) as Vector[];

const secret = "s".repeat(40);
const base = { nonce: "0123456789abcdef", method: "GET", path: "/api/internal/scrape-jobs/next", body: "" };
const now = new Date(1794042000 * 1000);

describe("signing vectors shared with the scraper", () => {
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    expect(signInternalRequest(v, v.secret)).toBe(v.signature);
    expect(
      verifyInternalSignature({ ...v, timestamp: String(v.timestamp) }, v.secret, new Date(v.timestamp * 1000)),
    ).toEqual({ ok: true });
  });

  it("covers a body, a query string and non-ASCII characters", () => {
    expect(vectors.some((v) => v.body !== "")).toBe(true);
    expect(vectors.some((v) => v.path.includes("?"))).toBe(true);
    expect(vectors.some((v) => /[^\x00-\x7f]/.test(v.path + v.body))).toBe(true);
  });
});

describe("verifyInternalSignature", () => {
  const sign = (over: Partial<typeof base & { timestamp: number }> = {}) => {
    const parts = { ...base, timestamp: 1794042000, ...over };
    return { ...parts, timestamp: String(parts.timestamp), signature: signInternalRequest(parts, secret) };
  };

  it("accepts a fresh, genuine request", () => {
    expect(verifyInternalSignature(sign(), secret, now)).toEqual({ ok: true });
  });

  it("accepts the edge of the 5 minute window, in both directions, and refuses beyond", () => {
    expect(INTERNAL_TOLERANCE_SECONDS).toBe(300);
    expect(verifyInternalSignature(sign({ timestamp: 1794042000 - 300 }), secret, now)).toEqual({ ok: true });
    expect(verifyInternalSignature(sign({ timestamp: 1794042000 + 300 }), secret, now)).toEqual({ ok: true });
    expect(verifyInternalSignature(sign({ timestamp: 1794042000 - 301 }), secret, now)).toEqual({ ok: false, reason: "STALE" });
    expect(verifyInternalSignature(sign({ timestamp: 1794042000 + 301 }), secret, now)).toEqual({ ok: false, reason: "STALE" });
  });

  it("binds the signature to the method, the path, the body and the nonce", () => {
    const genuine = sign({ method: "POST", path: "/api/internal/scrape-jobs/a/results", body: '{"results":[]}' });
    expect(verifyInternalSignature(genuine, secret, now)).toEqual({ ok: true });
    for (const tampered of [
      { ...genuine, method: "PATCH" },
      { ...genuine, path: "/api/internal/scrape-jobs/b/results" },
      { ...genuine, path: genuine.path + "?x=1" },
      { ...genuine, body: '{"results":[{"companyName":"x"}]}' },
      { ...genuine, nonce: "ffffffffffffffff" },
      { ...genuine, timestamp: String(Number(genuine.timestamp) + 1) },
    ]) {
      expect(verifyInternalSignature(tampered, secret, now)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    }
  });

  it("refuses another secret", () => {
    expect(verifyInternalSignature(sign(), "x".repeat(40), now)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("refuses malformed input without throwing", () => {
    const good = sign();
    for (const bad of [
      { ...good, timestamp: null },
      { ...good, timestamp: "" },
      { ...good, timestamp: "abc" },
      { ...good, timestamp: "1.5" },
      { ...good, signature: null },
      { ...good, signature: "short" },
      { ...good, signature: good.signature.toUpperCase() },
      { ...good, nonce: "" },
      { ...good, nonce: "short" },
      { ...good, nonce: "n".repeat(129) },
    ]) {
      expect(verifyInternalSignature(bad, secret, now)).toEqual({ ok: false, reason: "MALFORMED" });
    }
  });

  it("hashes the body as UTF-8", () => {
    expect(bodyHash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(bodyHash("é")).not.toBe(bodyHash("e"));
  });
});
