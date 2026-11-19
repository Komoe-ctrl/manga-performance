import { addDays, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { fr } from "date-fns/locale";
import { REFERENCE_DATE } from "@/lib/constants";
import type {
  CollectionClient,
  CollectionEntity,
  CollectionPeriod,
  CollectionPlan,
  CollectionSubmission,
  CollectionTemplateInfo,
  PeriodStatus,
  SubmissionReport,
} from "@/lib/types/collection";

/* Données entièrement fictives (avenant n°1, §10 : aucune donnée réelle du client). */

export const collectionClients: CollectionClient[] = [
  { id: "cc-1", name: "Groupe Horizon Hospitality" },
  { id: "cc-2", name: "Atlas Développement" },
];

export const collectionEntities: CollectionEntity[] = [
  { id: "ce-1", clientId: "cc-1", name: "Hôtel Les Cocotiers", sector: "HOTELLERIE" },
  { id: "ce-2", clientId: "cc-1", name: "Hôtel Baie Sereine", sector: "HOTELLERIE" },
  { id: "ce-3", clientId: "cc-1", name: "Hôtel Cap Lumière", sector: "HOTELLERIE" },
  { id: "ce-4", clientId: "cc-1", name: "Restaurant Le Banian", sector: "RESTAURATION" },
  { id: "ce-5", clientId: "cc-2", name: "Atlas BTP — agence Nord", sector: "BTP" },
  { id: "ce-6", clientId: "cc-2", name: "Boutique Atlas Centre", sector: "COMMERCE" },
  { id: "ce-7", clientId: "cc-2", name: "Atlas Pay", sector: "TECH_FINTECH" },
];

export const collectionTemplates: CollectionTemplateInfo[] = [
  { id: "hotel_mensuel", label: "Hôtel — KPI mensuels", sector: "HOTELLERIE" },
  { id: "hotel_consommables_cpro", label: "Hôtel — Consommables (CPRO) et population", sector: "HOTELLERIE" },
  { id: "resto_mensuel", label: "Restauration — mensuel", sector: "RESTAURATION" },
  { id: "commerce_mensuel", label: "Commerce — mensuel", sector: "COMMERCE" },
  { id: "btp_chantiers", label: "BTP — chantiers actifs", sector: "BTP" },
  { id: "tech_mensuel", label: "Tech / Fintech — mensuel", sector: "TECH_FINTECH" },
];

const plan = (id: string, entityId: string, templateId: string, delayDays = 3): CollectionPlan => ({
  id,
  entityId,
  templateId,
  frequency: "MENSUELLE",
  delayDays,
  startsOn: "2026-04-01T00:00:00.000Z",
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
  // Délai de 30 jours : seul plan dont la période de septembre est encore « attendue ».
  plan("cp-10", "ce-7", "tech_mensuel", 30),
];

/** Avril à octobre 2026 (octobre n'est pas terminé à la date de référence). */
const MONTHS = [0, 1, 2, 3, 4, 5, 6].map((i) => addMonths(new Date("2026-04-01T00:00:00.000Z"), i));
export const collectionMonths = MONTHS.map((d) => ({ key: format(d, "yyyy-MM"), label: format(d, "MMM yyyy", { locale: fr }) }));

/** Statut imposé par (plan, mois) ; tout le reste est validé. Chaque statut du cycle de vie apparaît au moins une fois. */
const OVERRIDES: Record<string, PeriodStatus> = {
  "cp-2|2026-06": "ACCEPTE_AVEC_RESERVE",
  "cp-4|2026-08": "ACCEPTE_AVEC_RESERVE",
  "cp-8|2026-07": "ACCEPTE_AVEC_RESERVE",
  "cp-3|2026-08": "REJETE",
  "cp-7|2026-09": "REJETE",
  "cp-4|2026-09": "EN_RETARD",
  "cp-5|2026-09": "EN_RETARD",
  "cp-8|2026-09": "EN_RETARD",
  "cp-2|2026-09": "EN_CONTROLE",
  "cp-6|2026-09": "EN_CONTROLE",
  "cp-10|2026-09": "ATTENDU",
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

export function buildCollectionPeriods(): CollectionPeriod[] {
  const now = new Date(REFERENCE_DATE);
  const periods: CollectionPeriod[] = [];
  for (const p of collectionPlans) {
    for (const month of MONTHS) {
      const periodEnd = endOfMonth(month);
      const due = addDays(periodEnd, p.delayDays);
      const period: CollectionPeriod = {
        id: `${p.id}-${format(month, "yyyy-MM")}`,
        planId: p.id,
        periodStart: startOfMonth(month).toISOString(),
        periodEnd: periodEnd.toISOString(),
        dueAt: due.toISOString(),
        status: "A_VENIR",
        submissions: [],
        reminders: [],
      };
      if (periodEnd < now) {
        period.status = OVERRIDES[`${p.id}|${format(month, "yyyy-MM")}`] ?? "VALIDE";
        const name = `${p.templateId}_${format(month, "yyyy-MM")}.xlsx`;
        const sent = addDays(periodEnd, 2);
        if (period.status === "VALIDE") period.submissions = [submission(1, "VALIDE", sent, { errors: [], warnings: [] }, name)];
        if (period.status === "ACCEPTE_AVEC_RESERVE") {
          period.submissions = [
            submission(1, "REJETE", sent, REJECTION, name),
            submission(2, "ACCEPTE_AVEC_RESERVE", addDays(sent, 4), REJECTION, name, "Écart expliqué par l'entité (travaux en cours). Accepté avec réserve en attendant la régularisation."),
          ];
        }
        if (period.status === "REJETE") period.submissions = [submission(1, "REJETE", sent, p.templateId === "resto_mensuel" ? REJECTION_RESTO : REJECTION, name)];
        if (period.status === "EN_CONTROLE") period.submissions = [submission(1, "EN_CONTROLE", addDays(now, -1), null, name)];
        if (period.status === "EN_RETARD" || period.status === "REJETE") {
          const days = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
          if (days >= 1) period.reminders.push({ at: addDays(due, 1).toISOString(), kind: "J+1", recipients: "Contributeurs de l'entité" });
          if (days >= 3) period.reminders.push({ at: addDays(due, 3).toISOString(), kind: "J+3", recipients: "Contributeurs de l'entité" });
          if (days >= 5) period.reminders.push({ at: addDays(due, 5).toISOString(), kind: "J+5", recipients: "Contributeurs et direction du client" });
        }
      }
      periods.push(period);
    }
  }
  return periods;
}
