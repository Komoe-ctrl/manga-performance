import { applyVariables, hasMalformedVariable, unknownVariables } from "@manga/core";
import { textToTiptap, tiptapToHtml } from "@manga/core/rich-text";
import { SEQUENCE_TEMPLATES } from "@manga/emails/sequence-templates";
import { sequenceInputSchema } from "@manga/validation";
import { describe, expect, it } from "vitest";

describe("template sequences created by the seed", () => {
  it("are the three of the spec: a newsletter welcome and two manual ones", () => {
    expect(SEQUENCE_TEMPLATES).toHaveLength(3);
    expect(SEQUENCE_TEMPLATES.map((t) => t.trigger)).toEqual(["inscription_newsletter", "manuel", "manuel"]);
    expect(new Set(SEQUENCE_TEMPLATES.map((t) => t.name)).size).toBe(3);
  });

  it.each(SEQUENCE_TEMPLATES.map((t) => [t.name, t] as const))("%s passes the same validation as a sequence saved from the screen", (_name, template) => {
    const input = { name: template.name, trigger: template.trigger, active: false, steps: template.steps.map((s, i) => ({ order: i + 1, ...s })) };
    expect(sequenceInputSchema.safeParse(input).success).toBe(true);
    expect(template.steps[0]!.delayDays).toBe(0);
  });

  it.each(SEQUENCE_TEMPLATES.flatMap((t) => t.steps.map((s, i) => [`${t.name} / étape ${i + 1}`, s] as const)))("%s only uses allowed variables, well formed", (_label, step) => {
    for (const text of [step.subject, step.body]) {
      expect(unknownVariables(text)).toEqual([]);
      expect(hasMalformedVariable(text)).toBe(false);
    }
  });

  it.each(SEQUENCE_TEMPLATES.flatMap((t) => t.steps.map((s, i) => [`${t.name} / étape ${i + 1}`, s] as const)))("%s renders to clean HTML for a contact with no details", (_label, step) => {
    const html = applyVariables(tiptapToHtml(textToTiptap(step.body)), {}, { escape: true });
    const subject = applyVariables(step.subject, {});
    for (const text of [html, subject]) {
      expect(text).not.toContain("{{");
      expect(text).not.toContain("undefined");
    }
    expect(html.startsWith("<p>")).toBe(true);
    // The fallbacks read naturally.
    expect(subject.length).toBeGreaterThan(10);
  });

  it("address the contact by name when it is known", () => {
    const first = SEQUENCE_TEMPLATES[0]!.steps[0]!;
    expect(applyVariables(first.body, { prenom: "Awa" })).toContain("Bonjour Awa,");
    expect(applyVariables(first.body, {})).toContain("Bonjour cher abonné,");
  });
});
