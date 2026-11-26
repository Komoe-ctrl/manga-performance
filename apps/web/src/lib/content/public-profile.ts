import { services } from "@/lib/content/site";
import { isProvided } from "@/lib/content/provided";

/*
 * Ce que le cabinet publie sur son site et qu'il édite dans l'admin (Paramètres) : chiffres clés, informations légales,
 * cas client et FAQ de chaque service. Tout ce qui n'est pas fourni reste vide ici, et n'est donc pas affiché
 * publiquement (voir `provided.ts`).
 */

export interface KeyFigures {
  experience: string;
  missions: string;
  sectors: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ServicePageContent {
  caseStudy: { client: string; summary: string };
  faq: FaqItem[];
}

export interface PublicPages {
  legalForm: string;
  publicationDirector: string;
  host: string;
  privacyText: string;
  services: Record<string, ServicePageContent>;
}

/** Nombre d'emplacements de FAQ proposés par page de service (3 à 4 questions). */
export const FAQ_SLOTS = 4;

/** TODO(client): valeurs par défaut. Le cahier des charges indiquait « 10+ ans » ; le reste est à confirmer. */
export const DEFAULT_KEY_FIGURES: KeyFigures = { experience: "10+", missions: "50+", sectors: "7" };

export const defaultPublicPages = (): PublicPages => ({
  legalForm: "",
  publicationDirector: "",
  host: "",
  privacyText: "",
  services: Object.fromEntries(
    services.map((s) => [s.slug, { caseStudy: { client: "", summary: "" }, faq: Array.from({ length: FAQ_SLOTS }, () => ({ question: "", answer: "" })) }]),
  ),
});

/** Ce que le public peut lire : uniquement du contenu fourni. */
export interface PublicProfile {
  keyFigures: Partial<KeyFigures>;
  legal: { legalForm?: string; publicationDirector?: string; host?: string; privacyText?: string };
  services: Record<string, { caseStudy?: { client: string; summary: string }; faq: FaqItem[] }>;
}

const only = <T extends string>(value: T): T | undefined => (isProvided(value) ? (value.trim() as T) : undefined);

export function toPublicProfile(input: { keyFigures: KeyFigures; publicPages: PublicPages }): PublicProfile {
  const { keyFigures, publicPages } = input;
  return {
    keyFigures: { experience: only(keyFigures.experience), missions: only(keyFigures.missions), sectors: only(keyFigures.sectors) },
    legal: { legalForm: only(publicPages.legalForm), publicationDirector: only(publicPages.publicationDirector), host: only(publicPages.host), privacyText: only(publicPages.privacyText) },
    services: Object.fromEntries(
      Object.entries(publicPages.services).map(([slug, page]) => [
        slug,
        {
          caseStudy: isProvided(page.caseStudy.client) && isProvided(page.caseStudy.summary) ? { client: page.caseStudy.client.trim(), summary: page.caseStudy.summary.trim() } : undefined,
          faq: page.faq.filter((f) => isProvided(f.question) && isProvided(f.answer)).map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })),
        },
      ]),
    ),
  };
}

/** Données structurées Google d'une FAQ (JSON-LD `FAQPage`) ; `null` tant qu'aucune question n'est fournie. */
export function faqJsonLd(faq: FaqItem[]): Record<string, unknown> | null {
  const items = faq.filter((f) => isProvided(f.question) && isProvided(f.answer));
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.question.trim(), acceptedAnswer: { "@type": "Answer", text: f.answer.trim() } })),
  };
}
