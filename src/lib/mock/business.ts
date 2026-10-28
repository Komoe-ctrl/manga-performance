import type {
  BlogPost,
  ClientAccess,
  Deliverable,
  EmailSequence,
  Invoice,
  InvoiceStatus,
  Message,
  NewsletterSubscriber,
  ScrapeJob,
  ScrapeResult,
} from "@/lib/types";
import { prospects } from "./prospects";
import { createRng, daysFromToday, phoneCI } from "./random";

const clients = prospects.filter((p) => p.status === "client");

export const clientAccess: ClientAccess[] = clients.map((c, i) => ({
  clientId: c.id,
  active: i % 5 !== 4,
}));

// ---- Factures (~40) ----
const SERVICES = [
  { label: "Business plan bancable", price: 750_000 },
  { label: "Tableau de bord KPI", price: 500_000 },
  { label: "Plan de trésorerie", price: 350_000 },
  { label: "Mission de maîtrise des coûts", price: 900_000 },
  { label: "Journée de conseil", price: 150_000 },
];
const STATUSES: InvoiceStatus[] = ["payee", "payee", "payee", "en_attente", "en_retard", "emise", "brouillon"];

function buildInvoices(): Invoice[] {
  const rng = createRng(11);
  return Array.from({ length: 40 }, (_, i) => {
    const issuedOffset = -rng.int(1, 200);
    const status = rng.pick(STATUSES);
    const lines = Array.from({ length: rng.int(1, 3) }, () => {
      const s = rng.pick(SERVICES);
      return { label: s.label, quantity: rng.int(1, 3), unitPrice: s.price };
    });
    return {
      id: `inv${String(i + 1).padStart(3, "0")}`,
      number: `2026-${String(i + 1).padStart(3, "0")}`,
      fneNumber: status === "payee" || status === "emise" ? `FNE-${rng.int(100000, 999999)}` : undefined,
      clientId: clients[i % clients.length].id,
      lines,
      vatRate: 0.18,
      issuedAt: daysFromToday(issuedOffset),
      dueAt: daysFromToday(issuedOffset + 30),
      status: status === "en_attente" && issuedOffset < -45 ? "en_retard" : status,
      remindersSent: status === "en_retard" ? rng.int(0, 2) : 0,
    };
  });
}
export const invoices: Invoice[] = buildInvoices();

// ---- Séquences email ----
export const sequences: EmailSequence[] = [
  {
    id: "seq1",
    name: "Présentation → Étude de cas → Offre",
    trigger: "inscription_newsletter",
    active: true,
    steps: [
      { order: 1, delayDays: 0, subject: "Bienvenue, {{prenom}}", body: "Bonjour {{prenom}}, merci de votre intérêt pour MANGA PERFORMANCE. Voici comment nous aidons les entreprises du secteur {{secteur}}." },
      { order: 2, delayDays: 3, subject: "Comment une PME a repris la main sur ses coûts", body: "[Étude de cas à fournir par le client] — {{entreprise}} pourrait obtenir des résultats similaires." },
      { order: 3, delayDays: 7, subject: "Parlons de votre besoin : {{besoin}}", body: "{{prenom}}, souhaitez-vous échanger 30 minutes sur votre projet ?" },
    ],
    stats: { enrolled: 142, sent: 398, opened: 211, clicked: 57, unsubscribed: 6 },
  },
  {
    id: "seq2",
    name: "Relance après démo",
    trigger: "manuel",
    active: true,
    steps: [
      { order: 1, delayDays: 1, subject: "Votre démo du tableau de bord", body: "Bonjour {{prenom}}, merci d'avoir testé la démo." },
      { order: 2, delayDays: 5, subject: "Un tableau de bord pour {{entreprise}} ?", body: "Nous pouvons l'adapter à votre activité." },
    ],
    stats: { enrolled: 38, sent: 71, opened: 40, clicked: 12, unsubscribed: 1 },
  },
  {
    id: "seq3",
    name: "Réactivation prospects dormants",
    trigger: "manuel",
    active: false,
    steps: [
      { order: 1, delayDays: 0, subject: "Où en êtes-vous, {{prenom}} ?", body: "Cela fait quelque temps que nous n'avons pas échangé." },
    ],
    stats: { enrolled: 20, sent: 20, opened: 7, clicked: 1, unsubscribed: 2 },
  },
];

// ---- Scraper ----
export const scrapeJobs: ScrapeJob[] = [
  { id: "job1", source: "annuaire", filters: { sector: "Hôtellerie", city: "Abidjan - Cocody" }, status: "termine", startedAt: daysFromToday(-12), resultsCount: 90 },
  { id: "job2", source: "appels_offres", filters: { sector: "BTP" }, status: "termine", startedAt: daysFromToday(-5), resultsCount: 70 },
  { id: "job3", source: "site_web", filters: { size: "pme" }, status: "termine", startedAt: daysFromToday(-1), resultsCount: 40 },
];

function buildScrapeResults(): ScrapeResult[] {
  const rng = createRng(33);
  return scrapeJobs.flatMap((job) =>
    Array.from({ length: job.resultsCount }, (_, i) => {
      const dup = rng.next() < 0.08 ? rng.pick(prospects) : undefined;
      return {
        id: `${job.id}-r${i + 1}`,
        jobId: job.id,
        companyName: dup?.companyName ?? `Société ${rng.pick(["Alpha", "Bêta", "Gamma", "Delta", "Sigma"])} ${job.id.toUpperCase()}-${i + 1}`,
        sector: job.filters.sector ?? rng.pick(["Commerce", "Services", "BTP"]),
        address: rng.next() > 0.2 ? `${rng.int(1, 80)} rue ${rng.int(1, 40)}, ${rng.pick(["Abidjan", "Bouaké", "San-Pédro"])}` : undefined,
        phone: rng.next() > 0.3 ? phoneCI(rng) : undefined,
        email: rng.next() > 0.5 ? `info${i + 1}@exemple-${job.id}.example` : undefined,
        importedToCrm: false,
        duplicateOf: dup?.id,
      };
    }),
  );
}
export const scrapeResults: ScrapeResult[] = buildScrapeResults();

// ---- Livrables & messages ----
const DELIVERABLE_TITLES = ["Business plan", "Tableau de bord mensuel", "Plan de trésorerie 12 mois", "Rapport d'écarts budgétaires"];
export const deliverables: Deliverable[] = clients.flatMap((c, ci) =>
  DELIVERABLE_TITLES.slice(0, (ci % 3) + 1).map((title, di) => ({
    id: `d-${c.id}-${di + 1}`,
    clientId: c.id,
    title: `${title} — ${c.companyName}`,
    fileType: di % 2 === 0 ? ("pdf" as const) : ("xlsx" as const),
    sizeKb: 180 + ci * 37 + di * 90,
    publishedAt: daysFromToday(-(di * 20 + ci)),
    isNew: di === 0 && ci % 2 === 0,
  })),
);

export const messages: Message[] = clients.flatMap((c, ci) => [
  { id: `m-${c.id}-1`, clientId: c.id, from: "consultant" as const, body: "Bonjour, votre dernier livrable est disponible dans votre espace.", sentAt: daysFromToday(-6 - ci), read: true },
  { id: `m-${c.id}-2`, clientId: c.id, from: "client" as const, body: "Merci, je reviens vers vous après lecture.", sentAt: daysFromToday(-5 - ci), read: true },
  ...(ci % 3 === 0 ? [{ id: `m-${c.id}-3`, clientId: c.id, from: "consultant" as const, body: "Pouvons-nous planifier un point cette semaine ?", sentAt: daysFromToday(-1), read: false }] : []),
]);

// ---- Blog ----
const POST_TOPICS: [string, BlogPost["category"]][] = [
  ["Comment calculer son point mort en 5 étapes", "controle_de_gestion"],
  ["Cinq KPI à suivre chaque mois dans un hôtel", "data"],
  ["Préparer un audit interne sans stress", "audit"],
  ["Plan de trésorerie : les erreurs fréquentes", "controle_de_gestion"],
  ["Pourquoi votre tableau de bord est trop chargé", "data"],
  ["Maîtriser ses coûts dans la restauration", "controle_de_gestion"],
  ["Les contrôles clés avant une levée de fonds", "audit"],
  ["Automatiser ses rapports avec Excel", "data"],
];
export const blogPosts: BlogPost[] = POST_TOPICS.map(([title, category], i) => ({
  id: `b${i + 1}`,
  slug: title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
  title,
  excerpt: "[Extrait à fournir par le client] Un aperçu court de l'article pour la liste du blog.",
  category,
  content: "<p>[Contenu à fournir par le client]</p>",
  status: i < 6 ? "publie" : "brouillon",
  publishedAt: i < 6 ? daysFromToday(-10 * (i + 1)) : undefined,
  seo: { metaTitle: title },
}));

export const subscribers: NewsletterSubscriber[] = Array.from({ length: 30 }, (_, i) => ({
  id: `s${i + 1}`,
  email: `abonne${i + 1}@exemple.example`,
  confirmed: i % 6 !== 5,
  subscribedAt: daysFromToday(-i * 3),
  unsubscribedAt: i % 10 === 9 ? daysFromToday(-i) : undefined,
}));
