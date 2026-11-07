import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static safety net (spec, section 5): every Server Action and every Route Handler either
 * authorizes first, or is on a short, reviewed list of public entry points. A new endpoint
 * that forgets its guard fails here, even before anyone writes a test for it.
 */
const SRC = resolve(__dirname, "../src");

function walk(dir: string, match: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, match);
    return match(path) ? [path] : [];
  });
}
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(SRC, path).replaceAll("\\", "/");

const GUARD = /\b(runAdmin|runClient|requireAdmin|requireClient|requireAdminOrClient)\(/;

/** Public on purpose. Each has its own protection, named here. */
const PUBLIC_ACTIONS: Record<string, string> = {
  "acceptInvitationAction": "single-use signed token + rate limit",
  "requestPasswordResetAction": "generic answer + rate limit",
  "resetPasswordAction": "single-use signed token + rate limit",
};
const PUBLIC_RUNNER = /\brunPublic\(/; // published blog content only

const PUBLIC_ROUTES: Record<string, string> = {
  "app/api/auth/[...all]/route.ts": "Better Auth: login, lockout, rate limit",
  "app/api/health/route.ts": "minimal up/down answer",
  "app/api/leads/route.ts": "Turnstile + honeypot + rate limit",
  "app/api/newsletter/subscribe/route.ts": "Turnstile + honeypot + rate limit",
  "app/api/newsletter/confirm/route.ts": "single-use hashed token",
  "app/api/newsletter/unsubscribe/route.ts": "HMAC-signed link",
  "app/api/t/c/[id]/route.ts": "HMAC-signed tracking id",
  "app/api/t/o/[id]/route.ts": "HMAC-signed tracking id",
  "app/api/webhooks/email/route.ts": "provider signature / bearer secret",
  "app/api/internal/scrape-jobs/next/route.ts": "token + HMAC + replay protection (internal-api.ts)",
  "app/api/internal/scrape-jobs/[id]/results/route.ts": "token + HMAC + replay protection (internal-api.ts)",
  "app/api/internal/scrape-jobs/[id]/route.ts": "token + HMAC + replay protection (internal-api.ts)",
};

describe("Server Actions", () => {
  const files = walk(join(SRC, "server/actions"), (p) => p.endsWith(".ts") && !p.endsWith("result.ts"));

  it("found the action files", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  for (const file of files) {
    const chunks = read(file).split(/^export async function /m).slice(1);
    for (const chunk of chunks) {
      const name = chunk.slice(0, chunk.indexOf("("));
      it(`${rel(file)}: ${name} authorizes first`, () => {
        // The guard must come before anything else that reads or writes data.
        const body = chunk.slice(chunk.indexOf("{"));
        const publicOk = name in PUBLIC_ACTIONS || PUBLIC_RUNNER.test(body);
        const guardAt = body.search(GUARD);
        expect(publicOk || guardAt >= 0, `${name} has no guard and is not a reviewed public action`).toBe(true);
        if (!publicOk) {
          // Only parsing arguments may precede the guard inside the same call.
          expect(body.slice(0, guardAt)).not.toMatch(/\bprisma\b|getPrisma|await (get[A-Z]\w+\(\))/);
        }
      });
    }
  }

  it("keeps the reviewed public list honest", () => {
    const all = files.flatMap((f) => [...read(f).matchAll(/^export async function (\w+)/gm)].map((m) => m[1]));
    for (const name of Object.keys(PUBLIC_ACTIONS)) expect(all).toContain(name);
  });
});

describe("Route Handlers", () => {
  const routes = walk(join(SRC, "app/api"), (p) => p.endsWith("route.ts"));

  it("found the routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  for (const route of routes) {
    const name = rel(route);
    it(`${name} is guarded or reviewed public`, () => {
      if (name in PUBLIC_ROUTES) return;
      const source = read(route);
      // Delegated handlers (download-route.ts) are followed one level.
      const delegated = [...source.matchAll(/from "@\/server\/([^"]+)"/g)]
        .map((m) => join(SRC, "server", `${m[1]}.ts`))
        .flatMap((p) => {
          try {
            return [read(p)];
          } catch {
            return [];
          }
        });
      expect([source, ...delegated].some((text) => GUARD.test(text)), `${name} has no guard`).toBe(true);
    });
  }

  it("every public route is still on disk (no stale entries)", () => {
    const names = routes.map(rel);
    for (const name of Object.keys(PUBLIC_ROUTES)) expect(names).toContain(name);
  });
});
