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
import { CITIES, SECTORS } from "@/lib/constants";
import { createRng, daysFromToday, phoneCI } from "./random";

const NAME_HEADS = ["Lagune", "Ébène", "Baobab", "Soleil", "Atlantic", "Akwaba", "Kôkô", "Ivoire", "Savane", "Comoé", "Bandama", "Tamarin", "Palmeraie", "Nzi", "Sassandra", "Horizon", "Kalao", "Cacao"];
const NAME_TAILS: Record<string, string[]> = {
  Hôtellerie: ["Hôtel", "Résidence", "Lodge"],
  Santé: ["Clinique", "Polyclinique", "Centre Médical"],
  Restauration: ["Restaurant", "Maquis", "Traiteur"],
  "PME industrie": ["Industries", "Manufacture", "Agro-Transfo"],
  Commerce: ["Négoce", "Distribution", "Comptoir"],
  BTP: ["Construction", "Travaux", "Bâtiment"],
  Services: ["Conseil", "Services", "Logistique"],
};
const FIRST = ["Aya", "Kouadio", "Fatou", "Yao", "Mariam", "Koffi", "Awa", "Serge", "Adjoua", "Ibrahim", "Estelle", "Moussa", "Nadège", "Konan", "Salimata"];
const LAST = ["Kouassi", "Traoré", "Bamba", "N'Guessan", "Coulibaly", "Diabaté", "Yao", "Koné", "Ouattara", "Aka", "Tano", "Soro"];
const NEEDS: Need[] = ["business_plan", "tableau_de_bord", "tresorerie", "maitrise_couts", "audit", "autre"];
const SIZES: CompanySize[] = ["tpe", "pme", "pme", "grande_entreprise"];
const SOURCES: ProspectSource[] = ["site_formulaire", "chatbot", "scraper", "newsletter", "manuel", "recommandation"];

/** 15 clients, 20 en négociation, 15 nouveaux, 10 perdus = 60 */
const STATUS_PLAN: ProspectStatus[] = [
  ...Array<ProspectStatus>(15).fill("client"),
  ...Array<ProspectStatus>(20).fill("en_negociation"),
  ...Array<ProspectStatus>(15).fill("nouveau"),
  ...Array<ProspectStatus>(10).fill("perdu"),
];

function build(): Prospect[] {
  const rng = createRng(2026);
  return STATUS_PLAN.map((status, i) => {
    const sector = SECTORS[i % SECTORS.length];
    const tail = rng.pick(NAME_TAILS[sector]);
    const companyName = `${tail} ${NAME_HEADS[i % NAME_HEADS.length]}`;
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    const slug = companyName.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "");
    const active = status === "nouveau" || status === "en_negociation";
    return {
      id: `p${String(i + 1).padStart(3, "0")}`,
      companyName,
      contactName: `${first} ${last}`,
      email: rng.next() > 0.15 ? `contact@${slug}.example` : undefined,
      phone: rng.next() > 0.1 ? phoneCI(rng) : undefined,
      sector,
      city: rng.pick(CITIES),
      size: rng.pick(SIZES),
      need: rng.pick(NEEDS),
      status,
      source: rng.pick(SOURCES),
      estimatedValue:
        status === "perdu" ? undefined : rng.int(5, 60) * 100_000,
      createdAt: daysFromToday(-rng.int(1, 150)),
      nextFollowUpAt: active ? daysFromToday(rng.int(-5, 20)) : undefined,
    } satisfies Prospect;
  });
}

export const prospects: Prospect[] = build();

const SUMMARIES: Record<InteractionType, string[]> = {
  email: ["Envoi de la présentation du cabinet", "Réponse à la demande de devis", "Relance après envoi de l'offre"],
  appel: ["Appel de qualification : besoin confirmé", "Appel de suivi, décision attendue sous 15 jours", "Prise de rendez-vous"],
  reunion: ["Réunion de cadrage sur site", "Présentation de la démo du tableau de bord"],
  note: ["Contact recommandé par un client", "Budget à valider avec la direction"],
};

function buildInteractions(): Interaction[] {
  const rng = createRng(77);
  const types: InteractionType[] = ["email", "appel", "reunion", "note"];
  return Array.from({ length: 120 }, (_, i) => {
    const type = rng.pick(types);
    return {
      id: `i${String(i + 1).padStart(3, "0")}`,
      prospectId: prospects[i % prospects.length].id,
      type,
      summary: rng.pick(SUMMARIES[type]),
      date: daysFromToday(-rng.int(0, 90)),
    };
  });
}
export const interactions: Interaction[] = buildInteractions();

function buildFollowUps(): FollowUp[] {
  const rules: FollowUp["rule"][] = ["J+7", "J+15", "J+30", "manuel"];
  const rng = createRng(5);
  return prospects
    .filter((p) => p.nextFollowUpAt)
    .map((p, i) => ({
      id: `f${String(i + 1).padStart(3, "0")}`,
      prospectId: p.id,
      dueAt: p.nextFollowUpAt!,
      rule: rng.pick(rules),
      done: false,
    }));
}
export const followUps: FollowUp[] = buildFollowUps();
