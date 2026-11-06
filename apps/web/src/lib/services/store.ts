import { contactInfo, DEFAULT_WHATSAPP_MESSAGE } from "@/lib/content/site";
import * as m from "@/lib/mock/business";
import * as p from "@/lib/mock/prospects";

/** Store en mémoire (non persisté au rechargement, volontairement). */
export const db = {
  prospects: structuredClone(p.prospects),
  interactions: structuredClone(p.interactions),
  followUps: structuredClone(p.followUps),
  clientAccess: structuredClone(m.clientAccess),
  invoices: structuredClone(m.invoices),
  sequences: structuredClone(m.sequences),
  scrapeJobs: structuredClone(m.scrapeJobs),
  scrapeResults: structuredClone(m.scrapeResults),
  deliverables: structuredClone(m.deliverables),
  messages: structuredClone(m.messages),
  blogPosts: structuredClone(m.blogPosts),
  settings: {
    cabinetName: "MANGA PERFORMANCE",
    address: "Abidjan, Côte d'Ivoire",
    phone: contactInfo.phone,
    email: contactInfo.email,
    logoName: "",
    followUps: { j7: true, j15: true, j30: false },
    vatPercent: 18,
    invoiceMentions: "",
    bankDetails: "[À fournir par le client]",
    whatsappNumber: contactInfo.whatsappNumber,
    whatsappMessage: DEFAULT_WHATSAPP_MESSAGE,
  },
  invoiceEvents: {} as Record<string, { label: string; at: string }[]>,
  subscribers: structuredClone(m.subscribers),
};

export function latency<T>(value: () => T): Promise<T> {
  // Pas de latence côté serveur (prérendu) : elle sert aux états de chargement du client.
  if (typeof window === "undefined") return Promise.resolve(value());
  const ms = 150 + Math.floor(Math.random() * 250);
  return new Promise((resolve) => setTimeout(() => resolve(value()), ms));
}

let counter = 1000;
export const nextId = (prefix: string) => `${prefix}${++counter}`;
