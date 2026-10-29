import { contactInfo, services } from "@/lib/content/site";

export interface ChatLink {
  href: string;
  label: string;
}

export interface ChatAnswer {
  text: string;
  links?: ChatLink[];
  /** Affiche le formulaire de capture de lead. */
  form?: boolean;
  /** Questions de suivi proposées sous la réponse. */
  chips?: string[];
}

interface Ctx {
  waLink: string;
}

interface Entry {
  id: string;
  /** [expression sur le texte sans accents, poids] : le sujet au plus fort score répond ; à égalité, le premier de la liste. */
  k: [RegExp, number][];
  answer: (ctx: Ctx) => ChatAnswer;
}

const svc = (slug: string) => services.find((s) => s.slug === slug)!;
const serviceAnswer = (slug: string, extra: string): ChatAnswer => {
  const s = svc(slug);
  return {
    text: `${s.title} : ${s.short} ${extra}`,
    links: [
      { href: `/services/${slug}`, label: "Voir le détail de la mission" },
      { href: "/contact", label: "Discuter de mon besoin" },
    ],
    chips: ["Quels livrables ?", "Quels délais ?", "Être recontacté"],
  };
};

/**
 * Base de connaissances du chatbot (scripté, sans IA).
 * TODO: contenus à valider avec le client avant mise en ligne.
 */
const KB: Entry[] = [
  {
    id: "bonjour",
    k: [[/\b(bonjour|bonsoir|salut|hello|coucou|bjr|hey)\b/, 2]],
    answer: () => ({
      text: "Bonjour ! Je peux vous renseigner sur nos services, les délais, le déroulement d'une mission, ou vous mettre en relation avec un consultant.",
      chips: ["Nos services", "Comment ça se passe ?", "Être recontacté"],
    }),
  },
  {
    id: "merci",
    k: [[/\b(merci|parfait|genial|super|top)\b/, 2]],
    answer: () => ({ text: "Avec plaisir ! Avez-vous d'autres questions ?", chips: ["Être recontacté", "Parler sur WhatsApp"] }),
  },
  {
    id: "aurevoir",
    k: [[/au revoir|\bbye\b|a bientot|bonne journee|bonne soiree/, 3]],
    answer: () => ({ text: "Merci de votre visite, à très bientôt !" }),
  },
  {
    id: "robot",
    k: [
      [/\b(robot|bot|ia|intelligence artificielle|chatgpt|assistant)\b/, 3],
      [/qui es.?tu|tu es qui|vous etes qui/, 3],
    ],
    answer: () => ({
      text: "Je suis l'assistant automatique du cabinet. Je réponds à partir d'une base de questions fréquentes, pas d'une intelligence artificielle : pour une question précise, un consultant vous répond sous 24 h ouvrées.",
      chips: ["Être recontacté"],
    }),
  },
  {
    id: "cabinet",
    k: [[/cabinet|presentation|qui est|experience|parcours|diplome|\bmba\b|expert|competence/, 2]],
    answer: () => ({
      text: "MANGA PERFORMANCE est un cabinet de conseil indépendant basé à Abidjan, spécialisé en audit, data et contrôle de gestion. Le consultant est titulaire d'un MBA Audit & Contrôle de Gestion, avec plus de 10 ans d'expérience.",
      links: [{ href: "/a-propos", label: "En savoir plus sur le cabinet" }],
      chips: ["Nos références", "Nos services"],
    }),
  },
  {
    id: "services",
    k: [[/service|prestation|mission|propos|faites|offre|activite|domaine|\baide/, 1]],
    answer: () => ({
      text: "Nous accompagnons les entreprises sur quatre missions :",
      links: services.map((s) => ({ href: `/services/${s.slug}`, label: s.title })),
      chips: ["Comment ça se passe ?", "Tarifs"],
    }),
  },
  {
    id: "bp",
    k: [[/business ?plan|financement|banque|bancable|\bpret\b|credit|investisseur|levee de fonds/, 3]],
    answer: () =>
      serviceAnswer("business-plan-bancable", "Nous construisons des hypothèses argumentées et un modèle financier sur 3 à 5 ans, relus avec vous avant tout dépôt."),
  },
  {
    id: "kpi",
    k: [[/tableau|kpi|indicateur|dashboard|pilotage|reporting|suivi/, 3]],
    answer: () => ({
      ...serviceAnswer("tableaux-de-bord-kpi", "Les indicateurs sont choisis avec la direction, puis consolidés depuis vos sources."),
      links: [
        { href: "/demo", label: "Voir un tableau de bord d'exemple" },
        { href: "/services/tableaux-de-bord-kpi", label: "Voir la mission" },
      ],
    }),
  },
  {
    id: "tresorerie",
    k: [[/tresor|\bcash\b|encaissement|decaissement|liquidite|fin de mois/, 3]],
    answer: () => serviceAnswer("tresorerie", "Vous obtenez un plan de trésorerie glissant et des scénarios pour anticiper les tensions."),
  },
  {
    id: "couts",
    k: [[/maitris|reduire|baisser|economie|ecart|marge|rentabilite|\bcouts?\b|charges/, 3]],
    answer: () =>
      serviceAnswer("maitrise-des-couts", "Nous mesurons les écarts entre le prévu et le réalisé par poste, puis priorisons un plan d'actions chiffré."),
  },
  {
    id: "audit",
    k: [[/audit|controle interne|conformite|diagnostic|revue/, 3]],
    answer: () => ({
      text: "L'audit fait partie de l'ADN du cabinet : diagnostic de vos processus et de vos chiffres, avec des recommandations concrètes. Parlons de votre contexte pour cadrer la mission.",
      links: [{ href: "/blog", label: "Nos articles sur l'audit" }],
      chips: ["Être recontacté", "Quels délais ?"],
    }),
  },
  {
    id: "data",
    k: [[/\bdata\b|donnee|excel|power ?bi|automatis|analyse/, 2]],
    answer: () => ({
      text: "Nous structurons et fiabilisons vos données (souvent dispersées dans plusieurs fichiers Excel) pour en tirer des indicateurs exploitables et automatiser vos rapports.",
      links: [
        { href: "/services/tableaux-de-bord-kpi", label: "Tableaux de bord KPI" },
        { href: "/demo", label: "Voir la démo" },
      ],
    }),
  },
  {
    // Règle métier : jamais de prix affiché, proposer d'être recontacté.
    id: "tarifs",
    k: [
      [/\b(prix|tarifs?|devis|honoraires?)\b|combien (ca |cela )?(coute|cout)/, 5],
      [/\b(payer|paiement|cher|gratuit|budget)\b|combien|\bcoute/, 2],
    ],
    answer: () => ({
      text: "Chaque mission est chiffrée sur mesure selon votre besoin et la taille de votre entreprise. Laissez-moi vos coordonnées pour recevoir une proposition adaptée, sans engagement.",
      form: true,
    }),
  },
  {
    id: "delais",
    k: [
      [/combien de temps|delai|duree/, 5],
      [/\btemps\b|quand|rapide|livraison|urgent/, 3],
    ],
    answer: () => ({
      text: "Les délais dépendent de la mission et de la disponibilité de vos données. Un calendrier précis vous est proposé dès le premier échange.",
      links: [{ href: "/contact", label: "Prendre rendez-vous" }],
      chips: ["Comment ça se passe ?", "Être recontacté"],
    }),
  },
  {
    id: "process",
    k: [[/comment ca|deroul|etapes?|processus|demarrer|commencer|premiere|fonctionne|marche/, 2]],
    answer: () => ({
      text: "En général : 1) un échange pour comprendre votre besoin, 2) un cadrage et une proposition, 3) la réalisation avec points d'étape, 4) la remise des livrables et l'explication de leur usage. Vous suivez tout depuis votre espace client.",
      chips: ["Quels livrables ?", "Espace client", "Être recontacté"],
    }),
  },
  {
    id: "livrables",
    k: [[/livrables?|format|\bpdf\b|fichier|rapport|document|recevoir/, 3]],
    answer: () => ({
      text: "Selon la mission : rapports et synthèses en PDF, modèles et tableaux de bord en Excel, guides d'utilisation. Tout est publié dans votre espace client.",
      chips: ["Espace client", "Nos services"],
    }),
  },
  {
    id: "espace",
    k: [[/espace client|connexion|connecter|login|mot de passe|\bacces\b|identifiant/, 3]],
    answer: () => ({
      text: "Chaque client dispose d'un espace sécurisé pour retrouver ses livrables, échanger avec le consultant et recevoir des notifications. L'accès est créé par le cabinet.",
      links: [{ href: "/espace-client/connexion", label: "Accéder à l'espace client" }],
    }),
  },
  {
    id: "secteurs",
    k: [[/secteur|hotel|clinique|restaura|industrie|\bbtp\b|commerce|pour qui|\btpe\b|\bpme\b|grande entreprise|taille|association/, 2]],
    answer: () => ({
      text: "Nous travaillons avec des TPE, PME et grandes entreprises, notamment dans l'hôtellerie, la santé, la restauration, l'industrie, le commerce, le BTP et les services.",
      links: [{ href: "/references", label: "Voir nos références" }],
      chips: ["Nos services", "Être recontacté"],
    }),
  },
  {
    id: "references",
    k: [[/reference|temoignage|\bclients?\b|etude de cas|resultat|preuve/, 2]],
    answer: () => ({
      text: "Retrouvez nos études de cas anonymisées (contexte, mission, résultats chiffrés) et des témoignages de clients.",
      links: [{ href: "/references", label: "Voir les références" }],
    }),
  },
  {
    id: "zone",
    k: [[/ou etes|etes ou|ou se trouve|localis|situe|bureau|adresse|bouake|san.?pedro|yamoussoukro|deplac|interieur|region/, 3]],
    answer: () => ({
      text: `Le cabinet est basé à ${contactInfo.address}. Pour une mission dans une autre ville, contactez-nous : nous étudions les déplacements ou un suivi à distance.`,
      links: [{ href: "/contact", label: "Page contact" }],
    }),
  },
  {
    id: "coordonnees",
    k: [[/mail|telephone|numero|joindre|appeler|coordonnee|contact/, 2]],
    answer: () => ({
      text: `Téléphone : ${contactInfo.phone}. Email : ${contactInfo.email}.`,
      links: [{ href: "/contact", label: "Page contact" }],
      chips: ["Parler sur WhatsApp", "Être recontacté"],
    }),
  },
  {
    id: "horaires",
    k: [[/horaire|ouvert|ferme|heure/, 3]],
    answer: () => ({
      text: `${contactInfo.hours}. Hors horaires, laissez un message : un consultant vous répond sous 24 h ouvrées.`,
      chips: ["Être recontacté"],
    }),
  },
  {
    id: "recontact",
    k: [[/rendez|\brdv\b|rappel|recontact|contacter|parler|consultant|conseiller|humain|echanger/, 2]],
    answer: () => ({
      text: "Avec plaisir. Laissez-moi vos coordonnées, un consultant vous recontacte sous 24 h ouvrées.",
      form: true,
    }),
  },
  {
    id: "whatsapp",
    k: [[/whats?app|watsap/, 3]],
    answer: ({ waLink }) => ({ text: "Vous pouvez nous écrire directement sur WhatsApp :", links: [{ href: waLink, label: "Ouvrir WhatsApp" }] }),
  },
  {
    id: "demo",
    k: [[/demo|exemple|essai|tester|voir un/, 2]],
    answer: () => ({
      text: "Vous pouvez explorer un tableau de bord d'exemple (données fictives) : filtres par hôtel, produit et période, KPI, écarts prévu/réalisé.",
      links: [{ href: "/demo", label: "Voir la démo" }],
    }),
  },
  {
    id: "blog",
    k: [[/blog|article|actualite|newsletter|abonn|conseils?/, 2]],
    answer: () => ({
      text: "Retrouvez nos conseils de gestion et de pilotage sur le blog, et inscrivez-vous à la newsletter depuis la page d'accueil.",
      links: [{ href: "/blog", label: "Lire le blog" }],
    }),
  },
  {
    id: "facture",
    k: [[/facture|\bfne\b|\bdgi\b|fiscal|\btva\b/, 3]],
    answer: () => ({
      text: "La facture fiscale est émise via la plateforme FNE de la DGI ; le numéro FNE est ensuite renseigné dans notre suivi de facturation.",
      chips: ["Être recontacté"],
    }),
  },
  {
    id: "donnees",
    k: [[/confidentiel|donnees personnelles|rgpd|vie privee|securite|protection|\bloi\b|secret/, 3]],
    answer: () => ({
      text: "Vos informations sont traitées de façon confidentielle et uniquement pour répondre à vos demandes, dans le respect de la loi ivoirienne n° 2013-450.",
      links: [{ href: "/confidentialite", label: "Politique de confidentialité" }],
    }),
  },
  {
    id: "langue",
    k: [[/anglais|english|langue|francais/, 3]],
    answer: () => ({
      text: "Le site et nos échanges sont en français. Pour une demande en anglais, écrivez-nous : nous étudierons ensemble la meilleure façon de vous accompagner.",
      chips: ["Être recontacté"],
    }),
  },
  {
    id: "formation",
    k: [[/formation|former|apprendre|atelier|coaching|accompagnement/, 2]],
    answer: () => ({
      text: "Chaque mission inclut l'explication des livrables pour que vos équipes soient autonomes. Une formation dédiée peut être discutée selon votre besoin.",
      chips: ["Être recontacté"],
    }),
  },
];

export const FALLBACK: ChatAnswer = {
  text: "Je suis un assistant automatique et je n'ai pas bien compris votre question. Voici des sujets que je connais, ou laissez vos coordonnées pour qu'un consultant vous réponde.",
  chips: ["Nos services", "Tarifs", "Comment ça se passe ?", "Être recontacté"],
  links: [{ href: "/contact", label: "Écrire au cabinet" }],
};

/** Réponse la plus pertinente pour un texte libre (mots-clés pondérés), ou le repli explicite. */
export function answerFor(text: string, ctx: Ctx): ChatAnswer {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  let best: Entry | null = null;
  let bestScore = 0;
  for (const entry of KB) {
    const score = entry.k.reduce((sum, [re, weight]) => sum + (re.test(t) ? weight : 0), 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best ? best.answer(ctx) : FALLBACK;
}

export const QUICK_QUESTIONS = ["Nos services", "Tarifs", "Délais", "Être recontacté", "Parler sur WhatsApp"];
