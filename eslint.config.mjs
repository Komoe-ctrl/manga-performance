import { defineConfig, globalIgnores } from "eslint/config";
import nextTs from "eslint-config-next/typescript";

// Shared config for packages/* and apps/worker.
// apps/web has its own config (Next.js core-web-vitals rules).
export default defineConfig([
  ...nextTs,
  globalIgnores(["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/src/generated/**"]),
]);
