import type { Prisma, PrismaClient } from "@manga/db";
import type { ReferenceInput, TestimonialInput } from "@manga/validation";
import type { PublicReference, PublicTestimonial, ReferenceView, TestimonialView } from "@/lib/types/references";
import { DomainError } from "../domain-error";
import { createUploadService, type UploadTicket } from "../files/upload-service";
import { recordAudit } from "../repositories/audit";
import type { ObjectStorage } from "../storage/object-storage";

export type { PublicReference, PublicTestimonial, ReferenceView, TestimonialView };

export interface ReferencesDeps {
  prisma: PrismaClient;
  storage: ObjectStorage;
  /** Where `public/references/*` is served from (bucket public URL). */
  publicBaseUrl: string;
  /** Refreshes the cached public pages (`revalidatePath` in production). */
  revalidate?: (paths: string[]) => void;
  now?: () => Date;
}

/** Public pages that show references and testimonials. */
export const REFERENCE_PATHS = ["/", "/references"];

type ReferenceRow = Prisma.ReferenceGetPayload<object>;
type TestimonialRow = Prisma.TestimonialGetPayload<{ include: { reference: { select: { name: true } } } }>;

const sameName = (name: string) => ({ equals: name, mode: "insensitive" as const });

/**
 * Client references and testimonials (site public). The rule that matters: nothing is public without the
 * written permission of the person or company named. It is checked here (clear message), in the public
 * queries (a revoked permission hides the item at once) and by a SQL constraint (nothing can bypass it).
 */
export function createReferencesService({ prisma, storage, publicBaseUrl, revalidate = () => undefined, now = () => new Date() }: ReferencesDeps) {
  const uploads = createUploadService({ storage });
  const base = publicBaseUrl.replace(/\/$/, "");

  const logoUrl = (key: string | null) => (key ? `${base}/${key}` : undefined);
  const toReference = (row: ReferenceRow): ReferenceView => ({
    id: row.id,
    name: row.name,
    sector: row.sector,
    description: row.description,
    logoUrl: logoUrl(row.logoKey),
    url: row.url ?? undefined,
    displayOrder: row.displayOrder,
    published: row.published,
    clientAuthorization: row.clientAuthorization,
  });
  const toTestimonial = (row: TestimonialRow): TestimonialView => ({
    id: row.id,
    quote: row.quote,
    author: row.author,
    authorRole: row.authorRole,
    referenceId: row.referenceId,
    company: row.reference.name,
    published: row.published,
    writtenAuthorization: row.writtenAuthorization,
  });

  return {
    // ---- back-office ----------------------------------------------------------------

    async listReferences(): Promise<ReferenceView[]> {
      const rows = await prisma.reference.findMany({ where: { deletedAt: null }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
      return rows.map(toReference);
    },

    /** Creates (no `id`) or updates a reference. */
    async saveReference(input: ReferenceInput, actorId: string, id?: string): Promise<ReferenceView> {
      const data = input;
      const existing = id ? await prisma.reference.findFirst({ where: { id, deletedAt: null } }) : null;
      if (id && !existing) throw new DomainError("NOT_FOUND", "Référence introuvable.");

      if (data.published && !data.clientAuthorization) {
        throw new DomainError("VALIDATION", "Une référence ne peut être publiée qu'avec l'autorisation du client : cochez-la d'abord.");
      }
      const name = data.name.trim();
      const clash = await prisma.reference.findFirst({ where: { name: sameName(name), deletedAt: null, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true } });
      if (clash) throw new DomainError("DUPLICATE", "Une référence porte déjà ce nom.");

      const logoKey = data.logoKey ?? null;
      if (logoKey && logoKey !== existing?.logoKey) await uploads.verifyPublicLogo(logoKey);

      const fields = {
        name,
        sector: data.sector.trim(),
        description: data.description.trim(),
        logoKey,
        url: data.url ?? null,
        displayOrder: data.displayOrder ?? 0,
        published: data.published,
        clientAuthorization: data.clientAuthorization,
      };
      const row = existing ? await prisma.reference.update({ where: { id: existing.id }, data: fields }) : await prisma.reference.create({ data: fields });

      // The previous logo is no longer used: keep the public prefix free of orphans (best effort).
      if (existing?.logoKey && existing.logoKey !== logoKey) await storage.delete(existing.logoKey).catch(() => undefined);

      const action = !existing ? "reference.created" : data.published && !existing.published ? "reference.published" : !data.published && existing.published ? "reference.unpublished" : "reference.updated";
      await recordAudit(prisma, { actorId, action, entity: "Reference", entityId: row.id, diff: { name, published: row.published, clientAuthorization: row.clientAuthorization } });
      if (row.published || existing?.published) revalidate(REFERENCE_PATHS);
      return toReference(row);
    },

    /** Soft delete. A reference that still has testimonials cannot disappear under them. */
    async removeReference(id: string, actorId: string): Promise<void> {
      const existing = await prisma.reference.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new DomainError("NOT_FOUND", "Référence introuvable.");
      if ((await prisma.testimonial.count({ where: { referenceId: id, deletedAt: null } })) > 0) {
        throw new DomainError("CONFLICT", "Cette référence a des témoignages : supprimez-les d'abord.");
      }
      await prisma.reference.update({ where: { id }, data: { deletedAt: now(), published: false } });
      await recordAudit(prisma, { actorId, action: "reference.deleted", entity: "Reference", entityId: id, diff: { name: existing.name } });
      if (existing.published) revalidate(REFERENCE_PATHS);
    },

    /** Presigned upload of a logo to the public prefix (PNG or JPG only). */
    requestLogoUpload: (input: { filename: string; mimeType: string; sizeBytes: number }): Promise<UploadTicket> => uploads.requestPublicLogoUpload(input),

    async listTestimonials(): Promise<TestimonialView[]> {
      const rows = await prisma.testimonial.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, include: { reference: { select: { name: true } } } });
      return rows.map(toTestimonial);
    },

    /** Creates (no `id`) or updates a testimonial. */
    async saveTestimonial(input: TestimonialInput, actorId: string, id?: string): Promise<TestimonialView> {
      const existing = id ? await prisma.testimonial.findFirst({ where: { id, deletedAt: null } }) : null;
      if (id && !existing) throw new DomainError("NOT_FOUND", "Témoignage introuvable.");
      const reference = await prisma.reference.findFirst({ where: { id: input.referenceId, deletedAt: null } });
      if (!reference) throw new DomainError("VALIDATION", "Choisissez une référence existante.");

      if (input.published && !input.writtenAuthorization) {
        throw new DomainError("VALIDATION", "Un témoignage ne peut être publié qu'avec l'autorisation écrite de son auteur : cochez-la d'abord.");
      }
      // The company is named next to the quote: the client must have agreed to be named.
      if (input.published && !reference.clientAuthorization) {
        throw new DomainError("VALIDATION", `Le client « ${reference.name} » n'a pas donné son autorisation : le témoignage ne peut pas être publié.`);
      }

      const fields = {
        quote: input.quote.trim(),
        author: input.author.trim(),
        authorRole: input.authorRole.trim(),
        referenceId: reference.id,
        published: input.published,
        writtenAuthorization: input.writtenAuthorization,
      };
      const row = existing
        ? await prisma.testimonial.update({ where: { id: existing.id }, data: fields, include: { reference: { select: { name: true } } } })
        : await prisma.testimonial.create({ data: fields, include: { reference: { select: { name: true } } } });

      const action = !existing ? "testimonial.created" : input.published && !existing.published ? "testimonial.published" : !input.published && existing.published ? "testimonial.unpublished" : "testimonial.updated";
      await recordAudit(prisma, { actorId, action, entity: "Testimonial", entityId: row.id, diff: { author: row.author, published: row.published, writtenAuthorization: row.writtenAuthorization } });
      if (row.published || existing?.published) revalidate(REFERENCE_PATHS);
      return toTestimonial(row);
    },

    async removeTestimonial(id: string, actorId: string): Promise<void> {
      const existing = await prisma.testimonial.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new DomainError("NOT_FOUND", "Témoignage introuvable.");
      await prisma.testimonial.update({ where: { id }, data: { deletedAt: now(), published: false } });
      await recordAudit(prisma, { actorId, action: "testimonial.deleted", entity: "Testimonial", entityId: id, diff: { author: existing.author } });
      if (existing.published) revalidate(REFERENCE_PATHS);
    },

    // ---- public site ----------------------------------------------------------------

    /** Published and authorized, in display order. */
    async listPublicReferences(): Promise<PublicReference[]> {
      const rows = await prisma.reference.findMany({
        where: { deletedAt: null, published: true, clientAuthorization: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      });
      return rows.map((row) => {
        const { id, name, sector, description, logoUrl, url } = toReference(row);
        return { id, name, sector, description, logoUrl, url };
      });
    },

    /** Published, with the author's permission, and only if the named client agreed to be named. */
    async listPublicTestimonials(): Promise<PublicTestimonial[]> {
      const rows = await prisma.testimonial.findMany({
        where: { deletedAt: null, published: true, writtenAuthorization: true, reference: { deletedAt: null, clientAuthorization: true } },
        orderBy: { createdAt: "desc" },
        include: { reference: { select: { name: true } } },
      });
      return rows.map((row) => {
        const { id, quote, author, authorRole, company } = toTestimonial(row);
        return { id, quote, author, authorRole, company };
      });
    },
  };
}

export type ReferencesService = ReturnType<typeof createReferencesService>;
