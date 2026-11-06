import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, maskPii } from "../src/mask";

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("jean.dupont@acme.ci")).toBe("j***@acme.ci");
  });
  it("hides anything that is not an email", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@acme.ci")).toBe("***");
  });
});

describe("maskPhone", () => {
  it("keeps the country prefix and the last 4 digits", () => {
    expect(maskPhone("+2250102030405")).toBe("+225***0405");
  });
  it("handles numbers without a prefix", () => {
    expect(maskPhone("0102030405")).toBe("***0405");
  });
  it("hides very short values", () => {
    expect(maskPhone("123")).toBe("***");
  });
});

describe("maskPii", () => {
  it("masks nested email and phone fields without mutating the input", () => {
    const input = {
      id: "abc",
      email: "jean@acme.ci",
      contact: { phone: "+2250102030405", list: [{ email: "a@b.ci" }] },
    };
    const out = maskPii(input);
    expect(out).toEqual({
      id: "abc",
      email: "j***@acme.ci",
      contact: { phone: "+225***0405", list: [{ email: "a***@b.ci" }] },
    });
    expect(input.email).toBe("jean@acme.ci");
  });
  it("returns primitives untouched and stops at max depth", () => {
    expect(maskPii("text")).toBe("text");
    expect(maskPii(null)).toBeNull();
    const deep = { a: { b: { c: { d: { e: { f: { email: "x@y.ci" } } } } } } };
    expect(JSON.stringify(maskPii(deep))).toContain("x@y.ci");
  });
});
