import { resolve } from "node:path";
import type { NextConfig } from "next";

// The repository-level .env is the single source of configuration. Next.js only
// reads the app directory, so load the root file here (existing variables win).
try {
  process.loadEnvFile(resolve(process.cwd(), "../../.env"));
} catch {
  // No .env file (CI, production): variables come from the real environment.
}

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy (spec, section 5). Next.js inlines its bootstrap scripts, so
// `script-src` keeps 'unsafe-inline' until nonces are adopted (they would force every
// page to render dynamically, which conflicts with the static marketing pages).
// Third-party origins (Turnstile, S3 public prefix) are added when those steps land.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// HSTS is set by Caddy in production (spec, section 5).
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  transpilePackages: ["@manga/core", "@manga/db", "@manga/validation"],
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
