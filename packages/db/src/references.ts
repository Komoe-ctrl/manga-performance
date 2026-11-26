import type { PrismaClient } from "./generated/client";

/** Name, sector and description of the first reference of the site. No phone number is stored. */
export const STARTER_REFERENCE = "FELKAT";
export const STARTER_SECTOR = "Tech / SaaS — Intelligence artificielle conversationnelle";
export const STARTER_DESCRIPTION =
  "FELKAT développe des agents vocaux IA qui automatisent les appels des entreprises : réponse aux clients, qualification des prospects et campagnes d'appels, avec une expérience naturelle et disponible 24 h/24.";

/**
 * Creates FELKAT as the first reference, as a **draft**: neither published nor authorized. It stays invisible to
 * the public until the consultant adds the logo and ticks the client's authorization
 * in /admin/references. Safe to run repeatedly: an existing FELKAT (even edited, even deleted) is never touched.
 * Returns whether it was created.
 */
export async function seedStarterReference(prisma: PrismaClient): Promise<boolean> {
  const existing = await prisma.reference.findFirst({ where: { name: { equals: STARTER_REFERENCE, mode: "insensitive" } }, select: { id: true } });
  if (existing) return false;
  await prisma.reference.create({
    data: {
      name: STARTER_REFERENCE,
      sector: STARTER_SECTOR,
      description: STARTER_DESCRIPTION,
      displayOrder: 0,
      published: false,
      clientAuthorization: false,
    },
  });
  return true;
}
