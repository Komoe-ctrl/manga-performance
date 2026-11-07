import { resolve } from "node:path";
import { createPrismaClient, type PrismaClient } from "../src/index";

// The repository-level .env is the single source of configuration.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file: variables come from the real environment.
}

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/** Every sample record carries this marker in its notes, so a second run is recognised and skipped. */
const MARKER = "[données de démonstration]";

const PROSPECTS = [
  { companyName: "Hôtel Lagune Prestige", contactName: "Awa Koné", email: "awa.kone@lagune-prestige.example", phone: "+2250701020304", sector: "Hôtellerie", city: "Abidjan - Cocody", size: "PME", need: "TABLEAU_DE_BORD", status: "NOUVEAU", source: "SITE_FORMULAIRE", age: 2 },
  { companyName: "Clinique Sainte-Marie", contactName: "Dr Yao Kouadio", email: "direction@sainte-marie.example", phone: "+2250505060708", sector: "Santé", city: "Abidjan - Marcory", size: "PME", need: "TRESORERIE", status: "EN_NEGOCIATION", source: "RECOMMANDATION", age: 12, value: 3_500_000 },
  { companyName: "Boulangerie Akissi", contactName: "Akissi Bamba", email: "contact@akissi.example", phone: "+2250102030405", sector: "Restauration", city: "Bouaké", size: "TPE", need: "MAITRISE_COUTS", status: "NOUVEAU", source: "CHATBOT", age: 5 },
  { companyName: "Transports Soro & Fils", contactName: "Ibrahim Soro", email: "i.soro@soro-transports.example", phone: "+2250707080910", sector: "Services", city: "San-Pédro", size: "PME", need: "AUDIT", status: "PERDU", source: "MANUEL", age: 40, lost: "Budget indisponible cette année" },
  { companyName: "Société Tano BTP", contactName: "Marie Tano", email: "marie@tano-btp.example", phone: "+2250506070809", sector: "BTP", city: "Yamoussoukro", size: "GRANDE_ENTREPRISE", need: "BUSINESS_PLAN", status: "EN_NEGOCIATION", source: "SITE_FORMULAIRE", age: 20, value: 8_000_000 },
  { companyName: "Établissements Diallo Commerce", contactName: "Fatou Diallo", email: "fatou@diallo-commerce.example", phone: "+2250101020304", sector: "Commerce", city: "Abidjan - Yopougon", size: "PME", need: "AUTRE", status: "NOUVEAU", source: "NEWSLETTER", age: 1 },
] as const;

async function seedProspects(prisma: PrismaClient) {
  for (const p of PROSPECTS) {
    const created = await prisma.prospect.create({
      data: {
        companyName: p.companyName,
        companyNameNorm: p.companyName.toLowerCase(),
        contactName: p.contactName,
        email: p.email,
        phone: p.phone,
        sector: p.sector,
        city: p.city,
        size: p.size,
        need: p.need,
        status: p.status,
        source: p.source,
        estimatedValue: "value" in p ? p.value : undefined,
        lostReason: "lost" in p ? p.lost : undefined,
        notes: MARKER,
        consentAt: p.source === "MANUEL" ? null : ago(p.age),
        consentSource: p.source === "MANUEL" ? null : `lead:${p.source.toLowerCase()}`,
        createdAt: ago(p.age),
      },
    });
    await prisma.interaction.create({
      data: { prospectId: created.id, type: "NOTE", summary: "Premier contact enregistré.", occurredAt: ago(p.age), createdBy: "seed-dev" },
    });
    if (p.status === "EN_NEGOCIATION") {
      await prisma.interaction.create({
        data: { prospectId: created.id, type: "APPEL", summary: "Appel de cadrage : besoin confirmé, devis à envoyer.", occurredAt: ago(Math.max(1, p.age - 5)), createdBy: "seed-dev" },
      });
    }
    if (p.status === "NOUVEAU") {
      await prisma.followUp.create({ data: { prospectId: created.id, rule: "J+7", dueAt: new Date(Date.now() + (7 - p.age) * DAY) } });
    }
  }
  console.log(`${PROSPECTS.length} sample prospects created.`);
}

/** One converted client with a paid invoice and an overdue one, numbered gaplessly like the real service does. */
async function seedClient(prisma: PrismaClient) {
  const prospect = await prisma.prospect.create({
    data: {
      companyName: "Pharmacie du Plateau",
      companyNameNorm: "pharmacie du plateau",
      contactName: "Dr Aminata Traoré",
      email: "aminata@pharmacie-plateau.example",
      sector: "Santé",
      city: "Abidjan - Plateau",
      size: "PME",
      need: "TABLEAU_DE_BORD",
      status: "CLIENT",
      source: "RECOMMANDATION",
      notes: MARKER,
      convertedAt: ago(60),
      createdAt: ago(75),
    },
  });
  const client = await prisma.client.create({
    data: { prospectId: prospect.id, legalName: "Pharmacie du Plateau SARL", address: "Boulevard de la République, Plateau, Abidjan", taxId: "1234567A" },
  });

  const year = new Date().getUTCFullYear();
  const invoices = [
    { label: "Mise en place du tableau de bord", ht: 600_000, status: "PAYEE", issuedDaysAgo: 50, dueInDays: -20, paid: true },
    { label: "Suivi mensuel de trésorerie", ht: 250_000, status: "EN_RETARD", issuedDaysAgo: 35, dueInDays: -5, paid: false },
  ] as const;

  for (const [index, invoice] of invoices.entries()) {
    const vat = Math.round((invoice.ht * 1800) / 10_000);
    // As the real service does: lines on a draft, then the issue. A database trigger forbids touching the lines of an issued invoice.
    const draft = await prisma.invoice.create({
      data: {
        clientId: client.id,
        status: "BROUILLON",
        vatRate: 1800,
        totalHt: invoice.ht,
        totalVat: vat,
        totalTtc: invoice.ht + vat,
        createdAt: ago(invoice.issuedDaysAgo),
        lines: { create: [{ position: 1, label: invoice.label, quantity: 100, unitPrice: invoice.ht, total: invoice.ht }] },
      },
    });
    const created = await prisma.invoice.update({
      where: { id: draft.id },
      data: {
        number: `${year}-${String(index + 1).padStart(3, "0")}`,
        status: invoice.status,
        amountPaid: invoice.paid ? invoice.ht + vat : 0,
        issuedAt: ago(invoice.issuedDaysAgo),
        dueAt: new Date(Date.now() + invoice.dueInDays * DAY),
      },
    });
    if (invoice.paid) {
      await prisma.payment.create({ data: { invoiceId: created.id, amount: invoice.ht + vat, method: "VIREMENT", paidAt: ago(30), reference: "VIR-DEMO-001" } });
    }
  }
  // The counter must follow the numbers just used, or the next real invoice would collide.
  await prisma.invoiceCounter.upsert({ where: { year }, create: { year, value: invoices.length }, update: { value: invoices.length } });
  console.log("1 sample client with 2 invoices created.");
}

/**
 * Sample data for development only (spec, section 12): it never runs in production, nor against
 * a database that is not on this machine, and it skips a database that already holds real data.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (process.env.NODE_ENV === "production") throw new Error("db:seed:dev is refused in production.");
  const host = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.ALLOW_REMOTE_SEED_DEV !== "1") {
    throw new Error(`db:seed:dev is refused: ${host} is not a local database.`);
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    if ((await prisma.prospect.count({ where: { notes: MARKER } })) > 0) {
      console.log("Sample data already present: skipped.");
      return;
    }
    if ((await prisma.prospect.count()) > 0 || (await prisma.invoice.count()) > 0) {
      throw new Error("The database already holds prospects or invoices: refusing to mix them with sample data.");
    }
    // All or nothing: a failure must not leave half of the sample data behind.
    await prisma.$transaction(
      async (tx) => {
        await seedProspects(tx as PrismaClient);
        await seedClient(tx as PrismaClient);
      },
      { timeout: 60_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
