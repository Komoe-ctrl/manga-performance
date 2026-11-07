import { describe, expect, it } from "vitest";
import { generateToken, hashToken, safeEqualHex } from "../src/tokens";

describe("tokens", () => {
  it("generates unique URL-safe tokens of 32 bytes", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
  it("hashes deterministically and never returns the token", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
  it("compares digests in constant time", () => {
    const h = hashToken("x");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashToken("y"))).toBe(false);
    expect(safeEqualHex(h, "")).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
  });
});
