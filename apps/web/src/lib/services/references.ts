import type { PublicReference, PublicTestimonial, ReferenceView, TestimonialView } from "@/lib/types/references";
import * as actions from "@/server/actions/references";
import { ServiceError, USE_DB, unwrap } from "./data-source";
import { db, latency, nextId } from "./store";

/*
 * Références clients et témoignages. `db` : Server Actions (autorisation vérifiée par le serveur, dans les
 * requêtes publiques et par une contrainte SQL). `mock` : même règle, sur le store en mémoire de la démonstration.
 */

export type ReferenceDraft = {
  name: string;
  sector: string;
  description: string;
  /** Vide = aucun lien. */
  url: string;
  displayOrder: number;
  published: boolean;
  clientAuthorization: boolean;
  /** Clé du logo téléversé (`db`) ou aperçu local (`mock`) ; `null` = aucun logo. */
  logoKey: string | null;
};

export type TestimonialDraft = {
  quote: string;
  author: string;
  authorRole: string;
  referenceId: string;
  published: boolean;
  writtenAuthorization: boolean;
};

const invalid = (message: string, code = "VALIDATION") => new ServiceError(message, code);

// ---- public site -----------------------------------------------------------------

export const listPublicReferences = (): Promise<PublicReference[]> =>
  USE_DB
    ? unwrap(actions.listPublicReferencesAction())
    : latency(() =>
        db.references
          .filter((r) => r.published && r.clientAuthorization)
          .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
          .map(({ id, name, sector, description, logoUrl, url }) => ({ id, name, sector, description, logoUrl, url })),
      );

export const listPublicTestimonials = (): Promise<PublicTestimonial[]> =>
  USE_DB
    ? unwrap(actions.listPublicTestimonialsAction())
    : latency(() =>
        db.testimonials
          .filter((t) => t.published && t.writtenAuthorization && db.references.some((r) => r.id === t.referenceId && r.clientAuthorization))
          .map(({ id, quote, author, authorRole, company }) => ({ id, quote, author, authorRole, company })),
      );

// ---- back-office -----------------------------------------------------------------

export const listReferences = (): Promise<ReferenceView[]> =>
  USE_DB ? unwrap(actions.listReferencesAction()) : latency(() => [...db.references].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)));

export const listTestimonials = (): Promise<TestimonialView[]> => (USE_DB ? unwrap(actions.listTestimonialsAction()) : latency(() => [...db.testimonials]));

/** Même règle que le serveur : pas de publication sans l'autorisation. */
function checkReference(draft: ReferenceDraft) {
  if (!draft.name.trim() || !draft.sector.trim() || !draft.description.trim()) throw invalid("Nom, secteur et description sont obligatoires.");
  if (draft.published && !draft.clientAuthorization) throw invalid("Une référence ne peut être publiée qu'avec l'autorisation du client : cochez-la d'abord.");
}

export const saveReference = (id: string | null, draft: ReferenceDraft): Promise<ReferenceView> => {
  if (USE_DB) {
    return unwrap(
      actions.saveReferenceAction(id, {
        name: draft.name,
        sector: draft.sector,
        description: draft.description,
        logoKey: draft.logoKey,
        url: draft.url,
        displayOrder: draft.displayOrder,
        published: draft.published,
        clientAuthorization: draft.clientAuthorization,
      }),
    );
  }
  return latency(() => {
    checkReference(draft);
    if (db.references.some((r) => r.id !== id && r.name.trim().toLowerCase() === draft.name.trim().toLowerCase())) throw invalid("Une référence porte déjà ce nom.", "DUPLICATE");
    const fields = {
      name: draft.name.trim(),
      sector: draft.sector.trim(),
      description: draft.description.trim(),
      logoUrl: draft.logoKey ?? undefined,
      url: draft.url.trim() || undefined,
      displayOrder: draft.displayOrder,
      published: draft.published,
      clientAuthorization: draft.clientAuthorization,
    };
    const existing = id ? db.references.find((r) => r.id === id) : undefined;
    if (id && !existing) throw invalid("Référence introuvable.", "NOT_FOUND");
    if (existing) return Object.assign(existing, fields);
    const created: ReferenceView = { id: nextId("ref-"), ...fields };
    db.references.push(created);
    return created;
  });
};

export const deleteReference = (id: string): Promise<void> =>
  USE_DB
    ? unwrap(actions.deleteReferenceAction(id)).then(() => undefined)
    : latency(() => {
        if (db.testimonials.some((t) => t.referenceId === id)) throw invalid("Cette référence a des témoignages : supprimez-les d'abord.", "CONFLICT");
        db.references = db.references.filter((r) => r.id !== id);
      });

export const saveTestimonial = (id: string | null, draft: TestimonialDraft): Promise<TestimonialView> => {
  if (USE_DB) return unwrap(actions.saveTestimonialAction(id, draft));
  return latency(() => {
    const reference = db.references.find((r) => r.id === draft.referenceId);
    if (!reference) throw invalid("Choisissez une référence existante.");
    if (!draft.quote.trim() || !draft.author.trim() || !draft.authorRole.trim()) throw invalid("Citation, auteur et fonction sont obligatoires.");
    if (draft.published && !draft.writtenAuthorization) throw invalid("Un témoignage ne peut être publié qu'avec l'autorisation écrite de son auteur : cochez-la d'abord.");
    if (draft.published && !reference.clientAuthorization) throw invalid(`Le client « ${reference.name} » n'a pas donné son autorisation : le témoignage ne peut pas être publié.`);
    const fields = { ...draft, quote: draft.quote.trim(), author: draft.author.trim(), authorRole: draft.authorRole.trim(), company: reference.name };
    const existing = id ? db.testimonials.find((t) => t.id === id) : undefined;
    if (id && !existing) throw invalid("Témoignage introuvable.", "NOT_FOUND");
    if (existing) return Object.assign(existing, fields);
    const created: TestimonialView = { id: nextId("tm-"), ...fields };
    db.testimonials.unshift(created);
    return created;
  });
};

export const deleteTestimonial = (id: string): Promise<void> =>
  USE_DB
    ? unwrap(actions.deleteTestimonialAction(id)).then(() => undefined)
    : latency(() => {
        db.testimonials = db.testimonials.filter((t) => t.id !== id);
      });

/**
 * Logo : `db` envoie le fichier au stockage public par URL présignée (le serveur relit et contrôle le fichier à
 * l'enregistrement). `mock` : aperçu local, aucun stockage.
 */
export async function uploadReferenceLogo(file: File): Promise<{ key: string; previewUrl: string }> {
  if (!USE_DB) {
    const previewUrl = URL.createObjectURL(file);
    return { key: previewUrl, previewUrl };
  }
  const ticket = await unwrap(actions.requestReferenceLogoUploadAction({ filename: file.name, mimeType: file.type, sizeBytes: file.size }));
  let response: Response;
  try {
    response = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: file });
  } catch {
    throw new ServiceError("Impossible d'envoyer le logo. Vérifiez votre connexion.", "NETWORK");
  }
  if (!response.ok) throw new ServiceError("L'envoi du logo a échoué. Réessayez.", String(response.status));
  return { key: ticket.key, previewUrl: URL.createObjectURL(file) };
}
