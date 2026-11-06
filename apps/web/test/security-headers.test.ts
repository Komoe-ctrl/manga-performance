import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("security headers", async () => {
  const rules = await nextConfig.headers!();
  const headers = Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]));

  it("applies to every route", () => {
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
  });

  it("forbids framing and sniffing", () => {
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("sets referrer and permissions policies", () => {
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("ships a strict CSP", () => {
    const csp = headers["Content-Security-Policy"]!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
