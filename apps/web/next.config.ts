import { resolve } from "node:path";
import type { NextConfig } from "next";

// The repository-level .env is the single source of configuration. Next.js only
// reads the app directory, so load the root file here (existing variables win).
try {
  process.loadEnvFile(resolve(process.cwd(), "../../.env"));
} catch {
  // No .env file (CI, production): variables come from the real environment.
}

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  transpilePackages: ["@manga/core"],
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
