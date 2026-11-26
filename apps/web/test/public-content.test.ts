import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { toPublicPost } from "@/lib/content/blog";
import { excerptFromContent, hasPlaceholder, isProvided, textOfHtml } from "@/lib/content/provided";
import { DEFAULT_KEY_FIGURES, FAQ_SLOTS, defaultPublicPages, faqJsonLd, toPublicProfile } from "@/lib/content/public-profile";
import { services } from "@/lib/content/site";
import { blogPosts } from "@/lib/mock/business";
import type { BlogPost } from "@/lib/types";
import { COUNT_UP_MS, countUpAt, parseCountUp } from "@/lib/utils/count-up";

const SRC = resolve(import.meta.dirname, "../src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

const post = (over: Partial<BlogPost> = {}): BlogPost => ({
  id: "b",
  slug: "b",
  title: "Titre",
  excerpt: "Un extrait réel.",
  category: "data",
  content: "<p>Un contenu réel et suffisamment long pour être publié sur le site public.</p>",
  status: "publie",
  seo: {},
  ...over,
});

describe("what counts as provided (recette B1)", () => {
  it("recognises every placeholder wording, and only those", () => {
    for (const text of ["[À fournir par le client]", "[Extrait à fournir par le client] Un aperçu…", "[Contenu à fournir par le client]", "[À compléter]", "Texte [à fournir] ici"]) {
      expect(hasPlaceholder(text), text).toBe(true);
      expect(isProvided(text), text).toBe(false);
    }
    for (const text of ["", "   ", undefined, null]) expect(isProvided(text as string)).toBe(false);
    for (const text of ["10+", "Résidence Lagune", "Un texte [entre crochets] normal", "À fournir en fin de mission"]) expect(isProvided(text), text).toBe(true);
  });

  it("hides what the client has not provided from the public profile, and keeps the rest", () => {
    const pages = defaultPublicPages();
    pages.legalForm = "[À fournir par le client]";
    pages.host = "Hébergeur Exemple";
    pages.services["tresorerie"]!.caseStudy = { client: "Client fictif", summary: "[À fournir par le client]" };
    pages.services["tresorerie"]!.faq[0] = { question: "Une question ?", answer: "Une réponse." };
    pages.services["tresorerie"]!.faq[1] = { question: "Sans réponse ?", answer: "" };
    const profile = toPublicProfile({ keyFigures: { experience: "12+", missions: "", sectors: "[À fournir par le client]" }, publicPages: pages });

    expect(profile.keyFigures).toEqual({ experience: "12+", missions: undefined, sectors: undefined });
    expect(profile.legal).toEqual({ legalForm: undefined, publicationDirector: undefined, host: "Hébergeur Exemple", privacyText: undefined });
    expect(profile.services["tresorerie"]).toEqual({ caseStudy: undefined, faq: [{ question: "Une question ?", answer: "Une réponse." }] });
    expect(profile.services["business-plan-bancable"]).toEqual({ caseStudy: undefined, faq: [] });
    expect(JSON.stringify(profile)).not.toMatch(/À fournir/);
  });

  it("starts with nothing to show for what is not yet known, and the 10+ years of the brief for the key figures", () => {
    const profile = toPublicProfile({ keyFigures: DEFAULT_KEY_FIGURES, publicPages: defaultPublicPages() });
    expect(DEFAULT_KEY_FIGURES.experience).toBe("10+");
    expect(profile.legal).toEqual({});
    for (const s of services) expect(profile.services[s.slug]).toEqual({ caseStudy: undefined, faq: [] });
    expect(defaultPublicPages().services[services[0]!.slug]!.faq).toHaveLength(FAQ_SLOTS);
  });

  it("has no placeholder wording left in the code that renders the public site", () => {
    const files = [...walk(join(SRC, "app/(public)")), ...walk(join(SRC, "components/public")), ...walk(join(SRC, "components/demo"))].filter((f) => /\.(tsx|ts)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} renders the TBD placeholder`).not.toMatch(/\bTBD\b/);
      expect(text, `${file} contains « À fournir »`).not.toMatch(/À fournir/);
    }
  });
});

describe("blog: nothing without real content, and an automatic excerpt (recette B1)", () => {
  it("never publishes an article whose content or title page is still a placeholder", () => {
    expect(blogPosts.length).toBeGreaterThan(0);
    const published = blogPosts.map(toPublicPost).filter(Boolean);
    expect(published).toEqual([]); // the demo articles are placeholders: none is shown to the public
    expect(toPublicPost(post({ content: "<p>[Contenu à fournir par le client]</p>" }))).toBeNull();
    expect(toPublicPost(post({ content: "<p></p>" }))).toBeNull();
    expect(toPublicPost(post({ status: "brouillon" }))).toBeNull();
  });

  it("keeps a real excerpt, and generates one from the first 160 characters when it is missing or provisional", () => {
    expect(toPublicPost(post())!.excerpt).toBe("Un extrait réel.");
    const long = `<p>${"Mot ".repeat(80)}</p>`;
    for (const excerpt of ["", "   ", "[Extrait à fournir par le client] Un aperçu court"]) {
      const out = toPublicPost(post({ content: long, excerpt }))!;
      expect(out.excerpt.length).toBeLessThanOrEqual(161);
      expect(out.excerpt.endsWith("…")).toBe(true);
      expect(out.excerpt).not.toMatch(/\[|À fournir/);
    }
    // Short content is used as is, without an ellipsis.
    expect(excerptFromContent("<p>Court et net.</p>")).toBe("Court et net.");
    expect(textOfHtml("<p>Un&nbsp;&amp; deux</p><p>trois</p>")).toBe("Un & deux trois");
  });

  it("cuts at a word boundary, never in the middle of a word", () => {
    const text = excerptFromContent(`<p>${"abcdefghi ".repeat(30)}</p>`);
    expect(text.length).toBeLessThanOrEqual(161);
    expect(text.replace("…", "").trim().endsWith("abcdefghi")).toBe(true);
  });
});

describe("key figures counter ends on the configured value (recette B5)", () => {
  it("parses a number with its suffix, and leaves non-numeric figures alone", () => {
    expect(parseCountUp("10+")).toEqual({ target: 10, suffix: "+" });
    expect(parseCountUp("250")).toEqual({ target: 250, suffix: "" });
    expect(parseCountUp("12 ans")).toEqual({ target: 12, suffix: " ans" });
    expect(parseCountUp("MBA")).toBeNull();
    expect(parseCountUp("")).toBeNull();
  });

  it("starts at 0, only grows, and lands exactly on the target whatever it is", () => {
    for (const target of [0, 1, 7, 10, 50, 99, 150, 1200]) {
      expect(countUpAt(target, 0)).toBe(0);
      let previous = 0;
      for (let ms = 0; ms <= COUNT_UP_MS; ms += 20) {
        const value = countUpAt(target, ms);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeLessThanOrEqual(target);
        previous = value;
      }
      expect(countUpAt(target, COUNT_UP_MS)).toBe(target);
      expect(countUpAt(target, COUNT_UP_MS * 10)).toBe(target);
    }
    expect(countUpAt(10, -500)).toBe(0);
  });
});

describe("service pages (recette B6)", () => {
  it("gives each of the four pages its own title and description, within search-result limits", () => {
    expect(services).toHaveLength(4);
    expect(new Set(services.map((s) => s.title)).size).toBe(4);
    expect(new Set(services.map((s) => s.seoDescription)).size).toBe(4);
    for (const s of services) {
      expect(s.seoDescription.length, s.slug).toBeGreaterThan(60);
      expect(s.seoDescription.length, s.slug).toBeLessThanOrEqual(160);
      expect(s.seoDescription).not.toBe(s.short);
    }
  });

  it("serves that metadata from the page, with a canonical address", async () => {
    vi.resetModules();
    const { generateMetadata } = await import("@/app/(public)/services/[slug]/page");
    const seen = new Set<string>();
    for (const s of services) {
      const meta = await generateMetadata({ params: Promise.resolve({ slug: s.slug }) });
      expect(meta.title).toBe(s.title);
      expect(meta.description).toBe(s.seoDescription);
      expect(meta.alternates?.canonical).toBe(`/services/${s.slug}`);
      seen.add(`${meta.title}|${meta.description}`);
    }
    expect(seen.size).toBe(4);
    expect(await generateMetadata({ params: Promise.resolve({ slug: "inconnu" }) })).toEqual({});
  });

  it("links the KPI and cost pages to the demo, and gives the other two a deliverables preview", () => {
    const bySlug = Object.fromEntries(services.map((s) => [s.slug, s]));
    expect(bySlug["tableaux-de-bord-kpi"]!.demo?.href).toBe("/demo");
    expect(bySlug["maitrise-des-couts"]!.demo?.href).toBe("/demo");
    for (const slug of ["business-plan-bancable", "tresorerie"]) {
      expect(bySlug[slug]!.demo).toBeUndefined();
      expect(bySlug[slug]!.deliverables.length).toBeGreaterThan(0);
    }
  });

  it("builds FAQPage structured data from the questions provided, and nothing when there are none", () => {
    expect(faqJsonLd([])).toBeNull();
    expect(faqJsonLd([{ question: "", answer: "" }, { question: "[À fournir par le client]", answer: "x" }])).toBeNull();
    const data = faqJsonLd([
      { question: " Combien de temps ? ", answer: " Environ trois semaines. " },
      { question: "Sans réponse ?", answer: "" },
      { question: "Et la suite ?", answer: "Un suivi." },
    ]);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Combien de temps ?", acceptedAnswer: { "@type": "Answer", text: "Environ trois semaines." } },
        { "@type": "Question", name: "Et la suite ?", acceptedAnswer: { "@type": "Answer", text: "Un suivi." } },
      ],
    });
  });

  it("cannot be broken out of its script tag by an answer", () => {
    const data = faqJsonLd([{ question: "Piège ?", answer: "</script><script>alert(1)</script>" }]);
    const html = JSON.stringify(data).replace(/</g, "\\u003c");
    expect(html).not.toContain("</script>");
    expect(JSON.parse(html).mainEntity[0].acceptedAnswer.text).toBe("</script><script>alert(1)</script>");
  });
});
