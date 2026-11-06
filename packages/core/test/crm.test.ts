import { describe, expect, it } from "vitest";
import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  bucketFollowUp,
  closesProspect,
  findDuplicateReason,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  planFollowUps,
  trigramSimilarity,
} from "../src/index";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jean.Dupont@ACME.ci ")).toBe("jean.dupont@acme.ci");
  });
});

describe("normalizePhone", () => {
  it.each([
    ["07 01 02 03 04", "+2250701020304"],
    ["0701020304", "+2250701020304"],
    ["+225 07 01 02 03 04", "+2250701020304"],
    ["00225 07.01.02.03.04", "+2250701020304"],
    ["(225) 07-01-02-03-04", "+2250701020304"],
    ["2250701020304", "+2250701020304"],
  ])("normalises %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "abc", "0701", "+33 6 12 34 56 78", "07010203040506"])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("normalizeCompanyName", () => {
  it("drops accents, case, punctuation and legal forms", () => {
    expect(normalizeCompanyName("Société Ébène S.A.R.L.")).toBe("societe ebene");
    expect(normalizeCompanyName("LAGUNE Hôtel, SA")).toBe("lagune hotel");
    expect(normalizeCompanyName("Cacao & Fils SAS")).toBe("cacao et fils");
    expect(normalizeCompanyName("Ets Konan")).toBe("konan");
  });
  it("keeps names made only of legal-form words empty", () => {
    expect(normalizeCompanyName("SARL")).toBe("");
  });
  it("is idempotent", () => {
    const once = normalizeCompanyName("Société Ébène S.A.R.L.");
    expect(normalizeCompanyName(once)).toBe(once);
  });
});

describe("trigramSimilarity", () => {
  it("matches pg_trgm reference values", () => {
    // similarity('word', 'two words') = 0.36363637 in PostgreSQL.
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(0.3636, 3);
    expect(trigramSimilarity("lagune", "lagune")).toBe(1);
  });
  it("scores near-duplicates above the threshold and different names below", () => {
    expect(trigramSimilarity("lagune hotel", "lagune hotels")).toBeGreaterThan(
      DUPLICATE_SIMILARITY_THRESHOLD,
    );
    expect(trigramSimilarity("lagune hotel", "baobab construction")).toBeLessThan(0.2);
  });
  it("returns 0 for empty input", () => {
    expect(trigramSimilarity("", "abc")).toBe(0);
    expect(trigramSimilarity("abc", "")).toBe(0);
  });
});

describe("findDuplicateReason", () => {
  const base = { email: "a@acme.ci", phone: "+2250701020304", companyNameNorm: "lagune hotel" };
  it("detects the same email (case-insensitive), phone and similar name, in that order", () => {
    expect(findDuplicateReason(base, { ...base, email: "A@ACME.CI", phone: "+2250000000000" })).toBe("EMAIL");
    expect(findDuplicateReason(base, { email: "x@y.ci", phone: base.phone, companyNameNorm: "zzz" })).toBe("PHONE");
    expect(findDuplicateReason(base, { email: null, phone: null, companyNameNorm: "lagune hotels" })).toBe("NAME");
  });
  it("returns null when nothing matches", () => {
    expect(findDuplicateReason(base, { email: "x@y.ci", phone: "+2250000000000", companyNameNorm: "baobab" })).toBeNull();
    expect(findDuplicateReason({ companyNameNorm: "acme" }, { companyNameNorm: "baobab" })).toBeNull();
  });
});

describe("planFollowUps", () => {
  const created = new Date("2026-11-06T09:00:00Z");
  it("schedules J+7, J+15 and J+30 according to the enabled rules", () => {
    const plan = planFollowUps(created, { j7: true, j15: true, j30: true });
    expect(plan.map((p) => p.rule)).toEqual(["J+7", "J+15", "J+30"]);
    expect(plan[0]!.dueAt).toEqual(new Date("2026-11-13T09:00:00Z"));
    expect(plan[2]!.dueAt).toEqual(new Date("2026-12-06T09:00:00Z"));
  });
  it("skips disabled rules", () => {
    expect(planFollowUps(created, { j7: true, j15: false, j30: false }).map((p) => p.rule)).toEqual(["J+7"]);
    expect(planFollowUps(created, { j7: false, j15: false, j30: false })).toEqual([]);
  });
});

describe("closesProspect", () => {
  it("only CLIENT and PERDU close a prospect", () => {
    expect(closesProspect("CLIENT")).toBe(true);
    expect(closesProspect("PERDU")).toBe(true);
    expect(closesProspect("NOUVEAU")).toBe(false);
    expect(closesProspect("EN_NEGOCIATION")).toBe(false);
  });
});

describe("bucketFollowUp", () => {
  // Africa/Abidjan is UTC+0 without DST, so days line up with UTC.
  const now = new Date("2026-11-06T12:00:00Z");
  it("buckets by calendar day in the display timezone", () => {
    expect(bucketFollowUp(new Date("2026-11-05T23:59:00Z"), now)).toBe("OVERDUE");
    expect(bucketFollowUp(new Date("2026-11-06T00:00:00Z"), now)).toBe("TODAY");
    expect(bucketFollowUp(new Date("2026-11-06T23:59:00Z"), now)).toBe("TODAY");
    expect(bucketFollowUp(new Date("2026-11-07T00:00:00Z"), now)).toBe("UPCOMING");
  });
  it("honours another timezone", () => {
    // 23:30 UTC on the 6th is already the 7th in Paris winter time (UTC+1).
    expect(bucketFollowUp(new Date("2026-11-06T23:30:00Z"), now, "Europe/Paris")).toBe("UPCOMING");
  });
});
