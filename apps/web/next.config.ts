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
// Browsers upload files straight to private storage with presigned URLs (spec, section 5).
const s3Origin = process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : "";
// Blog covers are public images served from the bucket (or its public domain).
const publicFilesOrigin = process.env.S3_PUBLIC_URL ? new URL(process.env.S3_PUBLIC_URL).origin : "";

// Content-Security-Policy (spec, section 5). Next.js inlines its bootstrap scripts, so
// `script-src` keeps 'unsafe-inline' until nonces are adopted (they would force every
// page to render dynamically, which conflicts with the static marketing pages).
// Cloudflare Turnstile is allowed for the public forms; the S3 public prefix is added with the blog step.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${s3Origin ? ` ${s3Origin}` : ""}${publicFilesOrigin && publicFilesOrigin !== s3Origin ? ` ${publicFilesOrigin}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self' https://challenges.cloudflare.com${s3Origin ? ` ${s3Origin}` : ""}${isDev ? " ws: wss:" : ""}`,
  "frame-src https://challenges.cloudflare.com",
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
  // `DATA_SOURCE=mock|db`, readable by client components (see lib/services/data-source.ts).
  env: { NEXT_PUBLIC_DATA_SOURCE: process.env.DATA_SOURCE === "db" ? "db" : "mock" },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  transpilePackages: ["@manga/core", "@manga/db", "@manga/emails", "@manga/validation"],
  serverExternalPackages: ["@node-rs/argon2", "pg", "pg-boss", "@react-pdf/renderer"],
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
