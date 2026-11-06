import { describe, expect, it } from "vitest";
import { checkPassword } from "../src/password";

describe("checkPassword", () => {
  it("accepts a long, uncommon password", () => {
    expect(checkPassword("Correct-Horse-Battery-9")).toEqual({ ok: true, issues: [] });
  });
  it("rejects fewer than 10 characters", () => {
    expect(checkPassword("Abc12345!").issues).toContain("TOO_SHORT");
  });
  it("counts characters, not bytes", () => {
    expect(checkPassword("éééééééééé").issues).not.toContain("TOO_SHORT");
  });
  it("rejects common passwords regardless of case", () => {
    expect(checkPassword("Azertyuiop").issues).toContain("TOO_COMMON");
    expect(checkPassword("MotDePasse123").issues).toContain("TOO_COMMON");
  });
  it("rejects a password containing the email local part", () => {
    expect(checkPassword("jean.dupont-2026!", "jean.dupont@acme.ci").issues).toContain(
      "CONTAINS_EMAIL",
    );
  });
  it("ignores very short email local parts", () => {
    expect(checkPassword("Correct-Horse-Battery-9", "al@acme.ci").ok).toBe(true);
    expect(checkPassword("Correct-Horse-Battery-9", "@acme.ci").ok).toBe(true);
  });
});
