import type {
  CompanySize as DbSize,
  InteractionType as DbInteractionType,
  Need as DbNeed,
  ProspectSource as DbSource,
  ProspectStatus as DbStatus,
} from "@manga/db";
import type {
  CompanySize,
  FollowUp,
  Interaction,
  InteractionType,
  Need,
  Prospect,
  ProspectSource,
  ProspectStatus,
} from "@/lib/types";

/** Database enums are UPPER_CASE, the front uses lower_case: same words, different case. */
export const toDbStatus = (value: ProspectStatus) => value.toUpperCase() as DbStatus;
export const toDbSource = (value: ProspectSource) => value.toUpperCase() as DbSource;
export const toDbSize = (value: CompanySize) => value.toUpperCase() as DbSize;
export const toDbNeed = (value: Need) => value.toUpperCase() as DbNeed;
export const toDbInteractionType = (value: InteractionType) =>
  value.toUpperCase() as DbInteractionType;

export function toFrontSource(value: DbSource): ProspectSource {
  // The front vocabulary has no "demo" source: demo leads are site leads.
  return value === "DEMO" ? "site_formulaire" : (value.toLowerCase() as ProspectSource);
}

interface ProspectRow {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  sector: string;
  city: string | null;
  size: DbSize | null;
  need: DbNeed | null;
  status: DbStatus;
  source: DbSource;
  estimatedValue: number | null;
  notes: string | null;
  createdAt: Date;
}

export function toFrontProspect(row: ProspectRow, nextFollowUpAt?: Date | null): Prospect {
  return {
    id: row.id,
    companyName: row.companyName,
    contactName: row.contactName ?? "",
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    sector: row.sector,
    city: row.city ?? "",
    size: (row.size?.toLowerCase() ?? "pme") as CompanySize,
    need: (row.need?.toLowerCase() ?? "autre") as Need,
    status: row.status.toLowerCase() as ProspectStatus,
    source: toFrontSource(row.source),
    estimatedValue: row.estimatedValue ?? undefined,
    ownerNote: row.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    nextFollowUpAt: nextFollowUpAt?.toISOString(),
  };
}

export function toFrontInteraction(row: {
  id: string;
  prospectId: string;
  type: DbInteractionType;
  summary: string;
  occurredAt: Date;
}): Interaction {
  return {
    id: row.id,
    prospectId: row.prospectId,
    type: row.type.toLowerCase() as InteractionType,
    summary: row.summary,
    date: row.occurredAt.toISOString(),
  };
}

export function toFrontFollowUp(row: {
  id: string;
  prospectId: string;
  rule: string;
  dueAt: Date;
  doneAt: Date | null;
}): FollowUp {
  return {
    id: row.id,
    prospectId: row.prospectId,
    dueAt: row.dueAt.toISOString(),
    rule: (row.rule === "MANUEL" ? "manuel" : row.rule) as FollowUp["rule"],
    done: row.doneAt !== null,
  };
}
