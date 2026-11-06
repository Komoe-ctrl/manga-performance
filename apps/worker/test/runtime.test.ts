import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production runtime", () => {
  it("renders React Email templates under `node --import tsx`, as the worker does", () => {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", resolve(import.meta.dirname, "fixtures/render-smoke.ts")],
      { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
    );
    const result = JSON.parse(output.trim().split("\n").pop()!);
    expect(result.subject).toBe("Réinitialisation de votre mot de passe");
    expect(result.hasHtml).toBe(true);
    expect(result.text).toContain("token=abc");
  });
});
