import type { Prisma, PrismaClient } from "@manga/db";
import { z } from "zod";
import { NEED_LABELS, SIZE_LABELS, SOURCE_LABELS, STATUS_LABELS } from "@/lib/constants";
import type { CompanySize, Need, ProspectSource, ProspectStatus } from "@/lib/types";
import { toFrontSource } from "../crm/mappers";
import { ExportError, MAX_EXPORT_ROWS, type ExportKind, type ExportTable } from "./types";

const text = z.string().trim().max(200);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The filters of each screen, validated again here: the browser is never trusted. */
const filterSchemas = {
  prospects: z.object({
    q: optional(text),
    status: optional(z.enum(Object.keys(STATUS_LABELS) as [ProspectStatus, ...ProspectStatus[]])),
    sector: optional(text),
    size: optional(z.enum(Object.keys(SIZE_LABELS) as [CompanySize, ...CompanySize[]])),
    need: optional(z.enum(Object.keys(NEED_LABELS) as [Need, ...Need[]])),
    source: optional(z.enum(Object.keys(SOURCE_LABELS) as [ProspectSource, ...ProspectSource[]])),
  }),
  invoices: z.object({
    status: optional(z.enum(["brouillon", "emise", "en_attente", "en_retard", "payee", "annulee"])),
    from: optional(day),
    to: optional(day),
    clientId: optional(z.string().max(64)),
  }),
  subscribers: z.object({
    status: optional(z.enum(["confirme", "en_attente", "desinscrit"])),
  }),
  "scrape-results": z.object({
    jobId: z.string().min(1).max(64),
  }),
} as const;

export type ExportFilters<K extends ExportKind> = z.output<(typeof filterSchemas)[K]>;

export function parseFilters<K extends ExportKind>(kind: K, params: URLSearchParams): ExportFilters<K> {
  const raw = Object.fromEntries(
    [...params.entries()].filter(([key]) => key !== "format" && key in filterSchemas[kind].shape),
  );
  const parsed = filterSchemas[kind].safeParse(raw);
  if (!parsed.success) throw new ExportError("INVALID", "Filtres d'export invalides.");
  return parsed.data as ExportFilters<K>;
}

const INVOICE_STATUS_FILTER: Record<string, Prisma.InvoiceWhereInput["status"]> = {
  brouillon: "BROUILLON",
  emise: "EMISE",
  // The screen merges "issued" and "partially paid" under "waiting for payment".
  en_attente: { in: ["EMISE", "PARTIELLEMENT_PAYEE"] },
  en_retard: "EN_RETARD",
  payee: "PAYEE",
  annulee: "ANNULEE",
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  BROUILLON: "Brouillon",
  EMISE: "Émise",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  EN_RETARD: "En retard",
  PAYEE: "Payée",
  ANNULEE: "Annulée",
};

function guardSize(rows: unknown[]): void {
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new ExportError("TOO_LARGE", `Plus de ${MAX_EXPORT_ROWS} lignes : affinez les filtres.`);
  }
}

/**
 * Builds the dataset of an export (spec, 6.11). Filters are re-applied here with the same
 * rules as the screens, so the file matches what the admin was looking at.
 */
export function createExportDatasets(prisma: PrismaClient) {
  return {
    async prospects(filters: ExportFilters<"prospects">): Promise<ExportTable> {
      const and: Prisma.ProspectWhereInput[] = [{ deletedAt: null }];
      const summary: string[] = [];
      if (filters.status) {
        and.push({ status: filters.status.toUpperCase() as Prisma.ProspectWhereInput["status"] });
        summary.push(`Statut : ${STATUS_LABELS[filters.status]}`);
      }
      if (filters.sector) {
        and.push({ sector: filters.sector });
        summary.push(`Secteur : ${filters.sector}`);
      }
      if (filters.size) {
        // The screens show an unknown size as "PME".
        and.push(filters.size === "pme" ? { OR: [{ size: "PME" }, { size: null }] } : { size: filters.size.toUpperCase() as "TPE" });
        summary.push(`Taille : ${SIZE_LABELS[filters.size]}`);
      }
      if (filters.need) {
        and.push(filters.need === "autre" ? { OR: [{ need: "AUTRE" }, { need: null }] } : { need: filters.need.toUpperCase() as "AUDIT" });
        summary.push(`Besoin : ${NEED_LABELS[filters.need]}`);
      }
      if (filters.source) {
        // Demo leads are shown as site leads.
        and.push(
          filters.source === "site_formulaire"
            ? { source: { in: ["SITE_FORMULAIRE", "DEMO"] } }
            : { source: filters.source.toUpperCase() as "CHATBOT" },
        );
        summary.push(`Source : ${SOURCE_LABELS[filters.source]}`);
      }
      if (filters.q) {
        const contains = { contains: filters.q, mode: "insensitive" as const };
        and.push({
          OR: [{ companyName: contains }, { contactName: contains }, { email: contains }, { sector: contains }, { city: contains }],
        });
        summary.push(`Recherche : « ${filters.q} »`);
      }

      const rows = await prisma.prospect.findMany({
        where: { AND: and },
        orderBy: { createdAt: "desc" },
        take: MAX_EXPORT_ROWS + 1,
        include: { followUps: { where: { doneAt: null, cancelledAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { dueAt: true } } },
      });
      guardSize(rows);

      return {
        slug: "prospects",
        title: "Prospects",
        filterSummary: summary,
        columns: [
          { header: "Entreprise", width: 3 },
          { header: "Contact", width: 2.2 },
          { header: "Email", width: 3 },
          { header: "Téléphone", width: 2 },
          { header: "Secteur", width: 2 },
          { header: "Ville", width: 1.6 },
          { header: "Besoin", width: 2 },
          { header: "Statut", width: 1.6 },
          { header: "Source", width: 2 },
          { header: "Valeur estimée (FCFA)", width: 2, type: "money" },
          { header: "Prochaine relance", width: 2, type: "date" },
          { header: "Créé le", width: 2, type: "date" },
        ],
        rows: rows.map((p) => [
          p.companyName,
          p.contactName,
          p.email,
          p.phone,
          p.sector,
          p.city,
          NEED_LABELS[(p.need?.toLowerCase() ?? "autre") as Need],
          STATUS_LABELS[p.status.toLowerCase() as ProspectStatus],
          SOURCE_LABELS[toFrontSource(p.source)],
          p.estimatedValue,
          p.followUps[0]?.dueAt ?? null,
          p.createdAt,
        ]),
      };
    },

    async invoices(filters: ExportFilters<"invoices">): Promise<ExportTable> {
      const where: Prisma.InvoiceWhereInput = {};
      const summary: string[] = [];
      if (filters.status) {
        where.status = INVOICE_STATUS_FILTER[filters.status];
        summary.push(`Statut : ${filters.status.replace("_", " ")}`);
      }
      // Same rule as the screen: compared on the issue date, in whole days.
      if (filters.from || filters.to) {
        where.issuedAt = {
          ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
          ...(filters.to ? { lt: new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
        };
        summary.push(`Émises ${filters.from ? `du ${filters.from} ` : ""}${filters.to ? `au ${filters.to}` : ""}`.trim());
      }
      if (filters.clientId) {
        // The screens use the prospect id as client id.
        where.client = { prospectId: filters.clientId };
        summary.push("Client sélectionné");
      }

      const rows = await prisma.invoice.findMany({
        where,
        orderBy: [{ issuedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
        take: MAX_EXPORT_ROWS + 1,
        include: { client: { select: { legalName: true } } },
      });
      guardSize(rows);

      return {
        slug: "factures",
        title: "Factures",
        filterSummary: summary,
        columns: [
          { header: "N°", width: 2 },
          { header: "Type", width: 1.2 },
          { header: "Client", width: 3 },
          { header: "Émise le", width: 2, type: "date" },
          { header: "Échéance", width: 2, type: "date" },
          { header: "Total HT", width: 2, type: "money" },
          { header: "TVA", width: 1.8, type: "money" },
          { header: "Total TTC", width: 2, type: "money" },
          { header: "Réglé", width: 2, type: "money" },
          { header: "Reste à payer", width: 2, type: "money" },
          { header: "Statut", width: 2 },
          { header: "N° FNE", width: 2 },
        ],
        rows: rows.map((i) => [
          i.number ?? "Brouillon",
          i.creditNoteOfId ? "Avoir" : "Facture",
          i.client.legalName,
          i.issuedAt,
          i.dueAt,
          i.totalHt,
          i.totalVat,
          i.totalTtc,
          i.amountPaid,
          Math.max(0, i.totalTtc - i.amountPaid),
          INVOICE_STATUS_LABELS[i.status] ?? i.status,
          i.fneNumber,
        ]),
      };
    },

    async subscribers(filters: ExportFilters<"subscribers">): Promise<ExportTable> {
      const where: Prisma.NewsletterSubscriberWhereInput = {};
      const summary: string[] = [];
      if (filters.status === "desinscrit") where.unsubscribedAt = { not: null };
      if (filters.status === "confirme") Object.assign(where, { unsubscribedAt: null, confirmedAt: { not: null } });
      if (filters.status === "en_attente") Object.assign(where, { unsubscribedAt: null, confirmedAt: null });
      if (filters.status) summary.push(`Statut : ${{ confirme: "Confirmé", en_attente: "En attente", desinscrit: "Désinscrit" }[filters.status]}`);

      const rows = await prisma.newsletterSubscriber.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: MAX_EXPORT_ROWS + 1,
        select: { email: true, createdAt: true, confirmedAt: true, unsubscribedAt: true },
      });
      guardSize(rows);

      return {
        slug: "abonnes-newsletter",
        title: "Abonnés à la newsletter",
        filterSummary: summary,
        columns: [
          { header: "Email", width: 4 },
          { header: "Statut", width: 1.6 },
          { header: "Inscrit le", width: 2, type: "date" },
          { header: "Confirmé le", width: 2, type: "date" },
          { header: "Désinscrit le", width: 2, type: "date" },
        ],
        rows: rows.map((s) => [
          s.email,
          s.unsubscribedAt ? "Désinscrit" : s.confirmedAt ? "Confirmé" : "En attente",
          s.createdAt,
          s.confirmedAt,
          s.unsubscribedAt,
        ]),
      };
    },

    async scrapeResults(filters: ExportFilters<"scrape-results">): Promise<ExportTable> {
      const job = await prisma.scrapeJob.findUnique({ where: { id: filters.jobId }, select: { id: true, source: true } });
      if (!job) throw new ExportError("NOT_FOUND", "Job introuvable.");
      const rows = await prisma.scrapeResult.findMany({
        where: { jobId: job.id },
        orderBy: { collectedAt: "asc" },
        take: MAX_EXPORT_ROWS + 1,
      });
      guardSize(rows);

      return {
        slug: "resultats-scraping",
        title: "Résultats de scraping",
        filterSummary: [`Job : ${job.id}`],
        columns: [
          { header: "Entreprise", width: 3 },
          { header: "Secteur", width: 2 },
          { header: "Ville", width: 1.6 },
          { header: "Adresse", width: 3 },
          { header: "Téléphone", width: 2 },
          { header: "Email", width: 3 },
          { header: "Doublon du CRM", width: 1.6 },
          { header: "Importé", width: 1.2 },
          { header: "Source", width: 3 },
          { header: "Collecté le", width: 2, type: "date" },
        ],
        rows: rows.map((r) => [
          r.companyName,
          r.sector,
          r.city,
          r.address,
          r.phone,
          r.email,
          r.duplicateOfProspectId ? "Oui" : "Non",
          r.importedProspectId ? "Oui" : "Non",
          r.sourceUrl,
          r.collectedAt,
        ]),
      };
    },
  };
}

export type ExportDatasets = ReturnType<typeof createExportDatasets>;
