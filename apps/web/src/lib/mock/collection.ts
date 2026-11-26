import { dayOffset, dueDate, isEnded, isLate, trackingMonths } from "@manga/core/collection/calendar";
import { REFERENCE_DATE } from "@/lib/constants";
import type {
  CollectionClient,
  CollectionEntity,
  CollectionPeriod,
  CollectionPlan,
  CollectionSubmission,
  CollectionTemplateInfo,
  PeriodStatus,
  Sector,
  SubmissionReport,
} from "@/lib/types/collection";
import { clientAccess } from "./business";
import { prospects } from "./prospects";

/* Données entièrement fictives (avenant n°1, §10 : aucune donnée réelle du client). */

const DAY_MS = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** Le jour d'aujourd'hui (UTC, minuit) : l'unique point de départ de tous les calculs de dates de la démo. */
export const referenceDay = (): Date => {
  const now = new Date(REFERENCE_DATE);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/*
 * Un seul jeu de fixtures : les clients de la collecte SONT des clients du CRM (même identifiant que le prospect
 * converti), avec leur accès à l'espace client, leurs factures et leurs livrables. Un hôtelier, un BTP, un commerce.
 */
const activeAccess = new Set(clientAccess.filter((a) => a.active).map((a) => a.clientId));
const crmClient = (sector: string) => {
  const found = prospects.find((p) => p.status === "client" && p.sector === sector && activeAccess.has(p.id));
  if (!found) throw new Error(`Aucun client « ${sector} » avec accès actif dans les fixtures.`);
  return found;
};
const hotelClient = crmClient("Hôtellerie");
const btpClient = crmClient("BTP");
const commerceClient = crmClient("Commerce");

export const collectionClients: CollectionClient[] = [hotelClient, btpClient, commerceClient].map((p) => ({ id: p.id, name: p.companyName }));

const entity = (id: string, client: { id: string }, name: string, sector: Sector): CollectionEntity => ({ id, clientId: client.id, name, sector });
export const collectionEntities: CollectionEntity[] = [
  entity("ce-1", hotelClient, "Hôtel Les Cocotiers", "HOTELLERIE"),
  entity("ce-2", hotelClient, "Hôtel Baie Sereine", "HOTELLERIE"),
  entity("ce-3", hotelClient, "Hôtel Cap Lumière", "HOTELLERIE"),
  entity("ce-4", hotelClient, "Restaurant Le Banian", "RESTAURATION"),
  entity("ce-5", btpClient, "Agence Nord — chantiers", "BTP"),
  entity("ce-6", commerceClient, "Boutique Centre", "COMMERCE"),
  entity("ce-7", commerceClient, "Plateforme de paiement", "TECH_FINTECH"),
];

export interface DemoPerson {
  id: string;
  clientId: string;
  name: string;
  email: string;
  role: "CLIENT_DIRECTION" | "CLIENT_CONTRIBUTEUR" | "CLIENT_ANALYSTE";
  active: boolean;
}

const slug = (name: string) => name.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "");
const TEAM: [string, string][] = [["Moussa", "Traoré"], ["Fanta", "Diallo"], ["Yao", "Konan"], ["Adjoua", "Kouassi"], ["Serge", "Bamba"], ["Nadège", "Tano"]];

/** Direction, contributeur et analyste de chaque client de la collecte : de quoi démontrer chaque rôle. */
export const collectionPeople: DemoPerson[] = [hotelClient, btpClient, commerceClient].flatMap((client, i) => {
  const domain = `${slug(client.companyName)}.example`;
  const person = (n: number, role: DemoPerson["role"], name: string, local: string): DemoPerson => ({ id: `cu-${i * 3 + n}`, clientId: client.id, name, email: `${local}@${domain}`, role, active: true });
  return [
    person(1, "CLIENT_DIRECTION", client.contactName, "direction"),
    person(2, "CLIENT_CONTRIBUTEUR", TEAM[i * 2]!.join(" "), "contributeur"),
    person(3, "CLIENT_ANALYSTE", TEAM[i * 2 + 1]!.join(" "), "analyste"),
  ];
});

/** Chaque contributeur est affecté à la première entité de son client : il ne voit rien d'autre. */
export const collectionAssignments: { userId: string; entityId: string }[] = collectionPeople
  .filter((p) => p.role === "CLIENT_CONTRIBUTEUR")
  .map((p) => ({ userId: p.id, entityId: collectionEntities.find((e) => e.clientId === p.clientId)!.id }));

export const collectionTemplates: CollectionTemplateInfo[] = [
  { id: "hotel_mensuel", label: "Hôtel — KPI mensuels", sector: "HOTELLERIE" },
  { id: "hotel_consommables_cpro", label: "Hôtel — Consommables (CPRO) et population", sector: "HOTELLERIE" },
  { id: "resto_mensuel", label: "Restauration — mensuel", sector: "RESTAURATION" },
  { id: "commerce_mensuel", label: "Commerce — mensuel", sector: "COMMERCE" },
  { id: "btp_chantiers", label: "BTP — chantiers actifs", sector: "BTP" },
  { id: "tech_mensuel", label: "Tech / Fintech — mensuel", sector: "TECH_FINTECH" },
];

const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });

/** Les 6 derniers mois clos puis le mois en cours, comptés à partir d'aujourd'hui (même calcul que l'affichage réel). */
const MONTHS = trackingMonths(referenceDay()).map((m) => m.start);
const keyOf = (month: Date) => month.toISOString().slice(0, 7);
export const collectionMonths = MONTHS.map((d) => ({ key: keyOf(d), label: monthLabel.format(d) }));

const plan = (id: string, entityId: string, templateId: string, delayDays = 3): CollectionPlan => ({
  id,
  entityId,
  templateId,
  frequency: "MENSUELLE",
  delayDays,
  startsOn: MONTHS[0]!.toISOString(),
  active: true,
});

export const collectionPlans: CollectionPlan[] = [
  plan("cp-1", "ce-1", "hotel_mensuel"),
  plan("cp-2", "ce-1", "hotel_consommables_cpro"),
  plan("cp-3", "ce-2", "hotel_mensuel"),
  plan("cp-4", "ce-2", "hotel_consommables_cpro"),
  plan("cp-5", "ce-3", "hotel_mensuel"),
  plan("cp-6", "ce-3", "hotel_consommables_cpro"),
  plan("cp-7", "ce-4", "resto_mensuel"),
  plan("cp-8", "ce-5", "btp_chantiers"),
  plan("cp-9", "ce-6", "commerce_mensuel"),
  // Délai de 30 jours : le dernier mois clos de ce plan reste « attendu » presque tout le mois en cours.
  plan("cp-10", "ce-7", "tech_mensuel", 30),
];

/**
 * Statut imposé par (plan, rang du mois) ; tout le reste est validé. Le rang compte en arrière depuis le mois en
 * cours : -1 = dernier mois clos, -2 = celui d'avant, etc. Chaque statut du cycle de vie apparaît au moins une fois,
 * quelle que soit la date du jour. « Attendu » et « en retard » se tranchent sur l'échéance réelle.
 */
const OVERRIDES: Record<string, PeriodStatus> = {
  "cp-2|-4": "ACCEPTE_AVEC_RESERVE",
  "cp-4|-2": "ACCEPTE_AVEC_RESERVE",
  "cp-8|-3": "ACCEPTE_AVEC_RESERVE",
  "cp-3|-2": "REJETE",
  "cp-7|-1": "REJETE",
  "cp-1|-1": "REJETE",
  "cp-4|-1": "EN_RETARD",
  "cp-5|-1": "EN_RETARD",
  "cp-8|-1": "EN_RETARD",
  // Toujours en retard : une échéance de plus d'un mois est passée, même les premiers jours du mois.
  "cp-9|-2": "EN_RETARD",
  "cp-2|-1": "EN_CONTROLE",
  "cp-6|-1": "EN_CONTROLE",
  "cp-10|-1": "ATTENDU",
};

const REJECTION: SubmissionReport = {
  errors: [
    { row: 7, column: "Chambres vendues", value: "4 100", message: "Ligne 7, Chambres vendues : 4 100 est supérieur aux chambres disponibles (3 600)." },
    { row: 7, column: "Revenus totaux d'exploitation HT", value: "38 400 000", message: "Ligne 7, Revenus totaux : 38 400 000 est inférieur au CA chambres (41 250 000)." },
  ],
  warnings: [{ message: "Fichier refait à la main : l'onglet _meta est absent, le fichier est contrôlé sans vérification de signature." }],
};
const REJECTION_RESTO: SubmissionReport = {
  errors: [{ row: 2, column: "CA HT (FCFA)", value: "douze millions", message: "Ligne 2, CA HT (FCFA) : « douze millions » n'est pas un montant. Saisissez un nombre entier." }],
  warnings: [],
};

function submission(version: number, status: CollectionSubmission["status"], at: Date, report: SubmissionReport | null, name: string, comment?: string): CollectionSubmission {
  return { id: `s-${name}-${version}`, version, originalName: name, uploadedBy: "Contributeur fictif", uploadedAt: at.toISOString(), status, report, reviewComment: comment };
}

/**
 * Périodes de la démo. Tout se calcule à partir de `today` avec les fonctions du calendrier de collecte (celles du
 * serveur) : une période est « à venir » tant qu'elle n'est pas terminée, « en retard » le lendemain de son échéance,
 * et le nombre de jours de retard est l'écart réel entre l'échéance et aujourd'hui.
 */
export function buildCollectionPeriods(today: Date = referenceDay()): CollectionPeriod[] {
  const months = trackingMonths(today);
  const periods: CollectionPeriod[] = [];
  for (const p of collectionPlans) {
    months.forEach((month, index) => {
      const rank = index - (months.length - 1);
      const key = keyOf(month.start);
      const due = dueDate(month.end, p.delayDays);
      const period: CollectionPeriod = {
        id: `${p.id}-${key}`,
        planId: p.id,
        periodStart: month.start.toISOString(),
        periodEnd: month.end.toISOString(),
        dueAt: due.toISOString(),
        status: "A_VENIR",
        submissions: [],
        reminders: [],
      };
      if (isEnded(month, today)) {
        const forced = OVERRIDES[`${p.id}|${rank}`];
        period.status = forced === "ATTENDU" || forced === "EN_RETARD" ? (isLate(due, today) ? "EN_RETARD" : "ATTENDU") : (forced ?? "VALIDE");
        const name = `${p.templateId}_${key}.xlsx`;
        const sent = addDays(month.end, 2);
        if (period.status === "VALIDE") period.submissions = [submission(1, "VALIDE", sent, { errors: [], warnings: [] }, name)];
        if (period.status === "ACCEPTE_AVEC_RESERVE") {
          period.submissions = [
            submission(1, "REJETE", sent, REJECTION, name),
            submission(2, "ACCEPTE_AVEC_RESERVE", addDays(sent, 4), REJECTION, name, "Écart expliqué par l'entité (travaux en cours). Accepté avec réserve en attendant la régularisation."),
          ];
        }
        if (period.status === "REJETE") period.submissions = [submission(1, "REJETE", sent, p.templateId === "resto_mensuel" ? REJECTION_RESTO : REJECTION, name)];
        if (period.status === "EN_CONTROLE") period.submissions = [submission(1, "EN_CONTROLE", addDays(today, -1), null, name)];
        if (period.status === "EN_RETARD" || period.status === "REJETE") {
          const days = dayOffset(due, today);
          if (days >= 1) period.reminders.push({ at: addDays(due, 1).toISOString(), kind: "J+1", recipients: "Contributeurs de l'entité" });
          if (days >= 3) period.reminders.push({ at: addDays(due, 3).toISOString(), kind: "J+3", recipients: "Contributeurs de l'entité" });
          if (days >= 5) period.reminders.push({ at: addDays(due, 5).toISOString(), kind: "J+5", recipients: "Contributeurs et direction du client" });
        }
      }
      periods.push(period);
    });
  }
  return periods;
}
