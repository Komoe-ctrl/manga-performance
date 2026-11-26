import type { PrismaClient } from "./generated/client";

/** Name of the first reference of the site. */
export const STARTER_REFERENCE = "FELKAT";

/**
 * Creates FELKAT as the first reference, as a **draft**: neither published nor authorized. It stays invisible to
 * the public until the consultant adds the logo, completes the description and ticks the client's authorization
 * in /admin/references. Safe to run repeatedly: an existing FELKAT (even edited, even deleted) is never touched.
 * Returns whether it was created.
 */
export async function seedStarterReference(prisma: PrismaClient): Promise<boolean> {
  const existing = await prisma.reference.findFirst({ where: { name: { equals: STARTER_REFERENCE, mode: "insensitive" } }, select: { id: true } });
  if (existing) return false;
  await prisma.reference.create({
    data: {
      name: STARTER_REFERENCE,
      sector: "À préciser",
      description: "Description à compléter.",
      displayOrder: 0,
      published: false,
      clientAuthorization: false,
    },
  });
  return true;
}
