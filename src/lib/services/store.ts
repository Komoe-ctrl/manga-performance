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
  subscribers: structuredClone(m.subscribers),
};

export function latency<T>(value: () => T): Promise<T> {
  const ms = 150 + Math.floor(Math.random() * 250);
  return new Promise((resolve) => setTimeout(() => resolve(value()), ms));
}

let counter = 1000;
export const nextId = (prefix: string) => `${prefix}${++counter}`;
