import { defineConfig, globalIgnores } from "eslint/config";
import nextTs from "eslint-config-next/typescript";

// Shared config for packages/* and apps/worker.
// apps/web has its own config (Next.js core-web-vitals rules).
export default defineConfig([
  ...nextTs,
  {
    rules: {
      // A leading underscore marks a value that is deliberately unused (rest-sibling omissions).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  globalIgnores(["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/src/generated/**"]),
]);
