import { describe, expect, it } from "vitest";
import {
  afterSend,
  isInSendWindow,
  nextSendAt,
  startOfLocalDay,
} from "../src/marketing-schedule";
import {
  RichTextError,
  htmlToText,
  isTiptapDoc,
  sanitizeRichHtml,
  textToTiptap,
  tiptapToHtml,
  tiptapToText,
} from "../src/rich-text";
import { hmacHex, safeEqualStrings, signToken, verifyToken } from "../src/signed-tokens";
import { slugify, uniqueSlug } from "../src/slug";
import {
  applyVariables,
  firstNameOf,
  hasMalformedVariable,
  unknownVariables,
} from "../src/template-vars";

describe("sanitizeRichHtml", () => {
  it("keeps the formatting TipTap produces", () => {
    const html = "<h2>Titre</h2><p>Un <strong>texte</strong> <em>riche</em></p><ul><li>a</li></ul><blockquote>q</blockquote>";
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it.each([
    ["<script>alert(1)</script><p>ok</p>", "<p>ok</p>"],
    ['<p onclick="alert(1)">x</p>', "<p>x</p>"],
    ['<img src=x onerror="alert(1)">', ""],
    ['<iframe src="https://evil.example"></iframe>', ""],
    ['<a href="javascript:alert(1)">clic</a>', "<a>clic</a>"],
    ['<a href="JaVaScRiPt:alert(1)">clic</a>', "<a>clic</a>"],
    ['<a href="data:text/html;base64,PHNjcmlwdD4=">clic</a>', "<a>clic</a>"],
    ['<a href="//evil.example/x">clic</a>', "<a>clic</a>"],
    ['<p style="background:url(javascript:alert(1))">x</p>', "<p>x</p>"],
    ["<form action=/x><input name=a></form>", ""],
    ['<svg onload="alert(1)"></svg>', ""],
    ["<style>body{display:none}</style><p>x</p>", "<p>x</p>"],
    ['<object data="x"></object><embed src="x">', ""],
  ])("neutralises %s", (input, expected) => {
    expect(sanitizeRichHtml(input)).toBe(expected);
  });

  it("forces safe attributes on web links and leaves mailto and tel alone", () => {
    expect(sanitizeRichHtml('<a href="https://example.com/a?b=1" target="_self" rel="opener">x</a>')).toBe(
      '<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer nofollow">x</a>',
    );
    expect(sanitizeRichHtml('<a href="mailto:a@b.ci">m</a><a href="tel:+2250700000000">t</a>')).toBe(
      '<a href="mailto:a@b.ci">m</a><a href="tel:+2250700000000">t</a>',
    );
  });

  it("can rewrite web links, e.g. to add click tracking", () => {
    const out = sanitizeRichHtml('<a href="https://example.com/x">a</a><a href="mailto:a@b.ci">m</a>', {
      rewriteLink: (href) => `https://app.example.com/t?u=${encodeURIComponent(href)}`,
    });
    expect(out).toContain('href="https://app.example.com/t?u=https%3A%2F%2Fexample.com%2Fx"');
    expect(out).toContain('href="mailto:a@b.ci"');
  });

  it("is idempotent", () => {
    const once = sanitizeRichHtml('<p>x <a href="https://example.com">y</a></p><script>1</script>');
    expect(sanitizeRichHtml(once)).toBe(once);
  });
});

describe("tiptapToHtml", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Titre" }] },
      { type: "paragraph", content: [{ type: "text", text: "Bonjour " }, { type: "text", text: "lien", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
    ],
  };

  it("renders a document to sanitized HTML", () => {
    expect(tiptapToHtml(doc)).toBe(
      '<h2>Titre</h2><p>Bonjour <a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">lien</a></p>',
    );
  });

  it("escapes text content", () => {
    const html = tiptapToHtml({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }] });
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("drops dangerous link targets that TipTap would pass through", () => {
    const html = tiptapToHtml({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] });
    expect(html).not.toContain("javascript");
  });

  it("refuses anything that is not a document, unknown nodes, and oversized content", () => {
    expect(() => tiptapToHtml(null)).toThrow(RichTextError);
    expect(() => tiptapToHtml("<p>html</p>")).toThrow(RichTextError);
    expect(() => tiptapToHtml({ type: "paragraph" })).toThrow(RichTextError);
    expect(() => tiptapToHtml({ type: "doc", content: [{ type: "scriptNode" }] })).toThrow(RichTextError);
    const huge = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(600_000) }] }] };
    expect(() => tiptapToHtml(huge)).toThrow(/volumineux/);
  });

  it("supports link rewriting", () => {
    const html = tiptapToHtml(doc, { rewriteLink: () => "https://t.example/1" });
    expect(html).toContain('href="https://t.example/1"');
  });
});

describe("plain text <-> TipTap", () => {
  it("round-trips paragraphs and line breaks", () => {
    const text = "Bonjour {{prenom}},\nsuite de la ligne\n\nDeuxième paragraphe";
    const doc = textToTiptap(text);
    expect(isTiptapDoc(doc)).toBe(true);
    expect(doc.content).toHaveLength(2);
    expect(tiptapToText(doc)).toBe(text);
  });
  it("ignores blank input and non-documents", () => {
    expect(textToTiptap("  \n\n ").content).toEqual([]);
    expect(tiptapToText({ nope: true })).toBe("");
    expect(isTiptapDoc(undefined)).toBe(false);
  });
  it("renders text documents to HTML", () => {
    expect(tiptapToHtml(textToTiptap("Un\n\nDeux"))).toBe("<p>Un</p><p>Deux</p>");
  });
  it("strips every tag for previews", () => {
    expect(htmlToText("<h2>Titre</h2> <p>Un   <strong>texte</strong></p><script>x</script>")).toBe("Titre Un texte");
  });
});

describe("template variables", () => {
  const values = { prenom: "Awa", entreprise: "Lagune Hôtel", secteur: "Hôtellerie", besoin: "votre audit" };

  it("fills the four variables", () => {
    expect(applyVariables("Bonjour {{prenom}}, {{entreprise}} ({{secteur}}) : {{besoin}}.", values)).toBe(
      "Bonjour Awa, Lagune Hôtel (Hôtellerie) : votre audit.",
    );
  });
  it("tolerates spaces and case in the name", () => {
    expect(applyVariables("{{ Prenom }}", values)).toBe("Awa");
  });
  it("uses the template's fallback, then the default, for missing or blank values", () => {
    expect(applyVariables("Bonjour {{prenom|cher partenaire}}", { prenom: undefined })).toBe("Bonjour cher partenaire");
    expect(applyVariables("Bonjour {{prenom|cher partenaire}}", { prenom: "   " })).toBe("Bonjour cher partenaire");
    expect(applyVariables("Bonjour {{prenom}}", {})).toBe("Bonjour cher client");
    expect(applyVariables("{{entreprise}} {{secteur}} {{besoin}}", {})).toBe("votre entreprise votre secteur vos besoins");
    expect(applyVariables("Bonjour {{prenom|}}", { prenom: null })).toBe("Bonjour cher client");
  });
  it("escapes values for HTML on demand, so a contact name cannot inject markup", () => {
    const evil = { prenom: '<img src=x onerror="alert(1)">&' };
    expect(applyVariables("{{prenom}}", evil)).toBe('<img src=x onerror="alert(1)">&');
    expect(applyVariables("{{prenom}}", evil, { escape: true })).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;");
  });
  it("does not re-expand variables found inside values", () => {
    expect(applyVariables("{{prenom}}", { prenom: "{{entreprise}}" })).toBe("{{entreprise}}");
  });
  it("blanks unknown variables when applied, and reports them for validation", () => {
    expect(applyVariables("a {{nom}} b", values)).toBe("a  b");
    expect(unknownVariables("{{prenom}} {{nom}} {{Telephone|x}} {{nom}}")).toEqual(["nom", "Telephone"]);
    expect(unknownVariables("{{prenom}} {{entreprise}}")).toEqual([]);
    expect(unknownVariables("rien ici")).toEqual([]);
  });
  it("spots unfinished variables", () => {
    expect(hasMalformedVariable("{{prenom}} ok")).toBe(false);
    expect(hasMalformedVariable("Bonjour {{prenom")).toBe(true);
    expect(hasMalformedVariable("fin }}")).toBe(true);
  });
  it("takes the first name", () => {
    expect(firstNameOf("Awa Koné")).toBe("Awa");
    expect(firstNameOf("  Kouadio ")).toBe("Kouadio");
    expect(firstNameOf("")).toBeUndefined();
    expect(firstNameOf(null)).toBeUndefined();
  });
});

describe("signed tokens", () => {
  const secret = "s".repeat(40);

  it("round-trips a payload", () => {
    const token = signToken("unsub", { email: "awa@lagune.ci" }, secret);
    expect(verifyToken("unsub", token, secret)).toEqual({ email: "awa@lagune.ci" });
  });
  it("refuses another purpose, another secret, and any alteration", () => {
    const token = signToken("unsub", { email: "awa@lagune.ci" }, secret);
    expect(verifyToken("open", token, secret)).toBeNull();
    expect(verifyToken("unsub", token, "x".repeat(40))).toBeNull();
    const [body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "victim@acme.ci" })).toString("base64url");
    expect(verifyToken("unsub", `${forged}.${signature}`, secret)).toBeNull();
    expect(verifyToken("unsub", `${body}.${signature!.slice(0, -2)}AA`, secret)).toBeNull();
  });
  it("refuses malformed tokens", () => {
    for (const bad of ["", "abc", "a.b.c", ".", "a.", ".b", "%%%.%%%"]) expect(verifyToken("unsub", bad, secret)).toBeNull();
    const body = Buffer.from("not json").toString("base64url");
    expect(verifyToken("unsub", `${body}.${"x".repeat(43)}`, secret)).toBeNull();
  });
  it("honours an expiry", () => {
    const token = signToken("t", { exp: Math.floor(Date.parse("2026-11-07T10:00:00Z") / 1000) }, secret);
    expect(verifyToken("t", token, secret, new Date("2026-11-07T09:59:00Z"))).not.toBeNull();
    expect(verifyToken("t", token, secret, new Date("2026-11-07T10:01:00Z"))).toBeNull();
  });
  it("compares secrets and signatures in constant time", () => {
    expect(safeEqualStrings("abc", "abc")).toBe(true);
    expect(safeEqualStrings("abc", "abd")).toBe(false);
    expect(safeEqualStrings("abc", "abcd")).toBe(false);
    expect(safeEqualStrings("", "")).toBe(false);
    expect(hmacHex("body", secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacHex("body", secret)).toBe(hmacHex("body", secret));
    expect(hmacHex("body2", secret)).not.toBe(hmacHex("body", secret));
  });
});

describe("send window", () => {
  // 2026-11-06 is a Friday, 2026-11-07 a Saturday, 2026-11-09 a Monday (Abidjan = UTC+0).
  it.each([
    ["2026-11-06T07:59:00Z", false],
    ["2026-11-06T08:00:00Z", true],
    ["2026-11-06T12:00:00Z", true],
    ["2026-11-06T17:59:00Z", true],
    ["2026-11-06T18:00:00Z", false],
    ["2026-11-06T23:00:00Z", false],
    ["2026-11-07T10:00:00Z", false], // Saturday
    ["2026-11-08T10:00:00Z", false], // Sunday
    ["2026-11-09T10:00:00Z", true], // Monday
  ])("%s -> %s", (iso, expected) => {
    expect(isInSendWindow(new Date(iso))).toBe(expected);
  });

  it("uses the given timezone", () => {
    // 07:30 UTC is 08:30 in Paris (UTC+1 in winter).
    expect(isInSendWindow(new Date("2026-11-06T07:30:00Z"), "Europe/Paris")).toBe(true);
    expect(isInSendWindow(new Date("2026-11-06T07:30:00Z"))).toBe(false);
  });

  it("finds the start of the local day", () => {
    expect(startOfLocalDay(new Date("2026-11-06T15:42:10.500Z"))).toEqual(new Date("2026-11-06T00:00:00Z"));
    expect(startOfLocalDay(new Date("2026-11-06T23:30:00Z"), "Europe/Paris")).toEqual(new Date("2026-11-06T23:00:00Z"));
  });
});

describe("sequence progress", () => {
  const steps = [
    { order: 1, delayDays: 0 },
    { order: 2, delayDays: 3 },
    { order: 3, delayDays: 7 },
  ];
  const sentAt = new Date("2026-11-06T10:00:00Z");

  it("schedules the next step by its own delay, then completes after the last", () => {
    expect(afterSend(steps, 0, sentAt)).toEqual({ status: "ACTIVE", currentStep: 1, nextSendAt: new Date("2026-11-09T10:00:00Z") });
    expect(afterSend(steps, 1, sentAt)).toEqual({ status: "ACTIVE", currentStep: 2, nextSendAt: new Date("2026-11-13T10:00:00Z") });
    expect(afterSend(steps, 2, sentAt)).toEqual({ status: "COMPLETED", currentStep: 3, nextSendAt: null });
  });
  it("adds whole days", () => {
    expect(nextSendAt(sentAt, 0)).toEqual(sentAt);
    expect(nextSendAt(sentAt, 1)).toEqual(new Date("2026-11-07T10:00:00Z"));
  });
});

describe("slugify", () => {
  it.each([
    ["Pilotez vos coûts : mode d'emploi", "pilotez-vos-couts-mode-d-emploi"],
    ["  Éléphant & Œuf — Côte d'Ivoire  ", "elephant-oeuf-cote-d-ivoire"],
    ["100 % PME", "100-pme"],
    ["!!!", "article"],
    ["", "article"],
  ])("%s -> %s", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });
  it("caps the length without leaving a trailing dash", () => {
    const slug = slugify("mot ".repeat(50));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
  it("finds the first free slug", async () => {
    const taken = new Set(["mon-article", "mon-article-2"]);
    const exists = async (s: string) => taken.has(s);
    expect(await uniqueSlug("autre", exists)).toBe("autre");
    expect(await uniqueSlug("mon-article", exists)).toBe("mon-article-3");
    expect(await uniqueSlug("x", async () => true)).toMatch(/^x-\d+$/);
  });
});
