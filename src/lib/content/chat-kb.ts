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
  /** Question de l'utilisateur, transmise avec la demande de rappel. */
  note?: string;
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
    k: [[/cabinet|presentation|qui est|qui etes|diakite|manga|experience|parcours|diplome|\bmba\b|expert|competence/, 2]],
    answer: () => ({
      text: "MANGA PERFORMANCE est le cabinet de Diakité Manga, consultant indépendant en audit, data analytique et contrôle de gestion, basé à Abidjan. Titulaire d'un MBA Audit & Contrôle de Gestion, avec plus de 10 ans d'expérience, il accompagne les dirigeants dans la maîtrise des coûts, le pilotage de la trésorerie et la décision basée sur les données.",
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
    k: [[/espace client|connexion|connect|login|mot de passe|\bacces\b|identifiant|\bcompte\b|inscri|se loguer/, 3]],
    answer: () => ({
      text: "Chaque client dispose d'un espace sécurisé pour retrouver ses livrables, échanger avec le consultant et recevoir des notifications. L'accès est créé par le cabinet : vous vous connectez avec votre email et votre mot de passe depuis la page de connexion. Pas encore d'accès ? Demandez-le à votre consultant.",
      links: [
        { href: "/espace-client/connexion", label: "Me connecter à mon espace" },
        { href: "/espace-client/mot-de-passe-oublie", label: "Mot de passe oublié" },
      ],
      chips: ["Être recontacté"],
    }),
  },
  {
    id: "secteurs",
    k: [[/secteur|hotel|clinique|restaura|industrie|\bbtp\b|commerce|pour qui|\btpe\b|\bpme\b|grande entreprise|taille|association/, 2]],
    answer: () => ({
      text: "J'interviens auprès des PME et startups, des hôtels, des restaurants et bars, ainsi que des cliniques et centres médicaux.",
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
  {
    // Formules fournies par le client ; aucun prix affiché (devis sur mesure).
    id: "formules",
    k: [[/formule|abonnement|diagnostic|pilotage complet|express|offres?\b|forfait|accompagnement mensuel/, 3]],
    answer: () => ({
      text: "Trois formules d'accompagnement : le Diagnostic Express (5 jours : audit flash + tableau de bord simplifié), le Pilotage Complet (3 mois : suivi mensuel + accompagnement) et l'Abonnement Mensuel (12 mois : reporting et alertes automatiques). Chacune est chiffrée sur mesure : laissez-moi vos coordonnées pour un devis.",
      form: true,
    }),
  },
  {
    id: "problemes",
    k: [[/budget previsionnel|decisions? intuitive|pas de tableau|tresorerie tendue|couts? non maitrises|je ne sais pas|aucun suivi/, 4]],
    answer: () => ({
      text: "Ce sont exactement les situations pour lesquelles on me sollicite : coûts non maîtrisés, absence de budget prévisionnel, trésorerie tendue, aucun tableau de bord, décisions prises à l'intuition. Parlons de votre cas.",
      links: [{ href: "/a-propos", label: "Voir mes missions clés" }],
      chips: ["Nos services", "Être recontacté"],
    }),
  },
  {
    id: "equipe",
    k: [[/qui travaille|equipe|effectif|combien de personnes|employes|collaborateurs|independant|seul/, 2]],
    answer: () => ({
      text: "MANGA PERFORMANCE est un cabinet indépendant dirigé par un consultant senior : vous avez un interlocuteur unique du premier échange à la remise des livrables.",
      links: [{ href: "/a-propos", label: "Découvrir le cabinet" }],
    }),
  },
  {
    id: "contrat",
    k: [[/contrat|engagement|signature|signer|acompte|modalites|conditions/, 3]],
    answer: () => ({
      text: "Le périmètre, le calendrier et les modalités de paiement sont précisés dans une proposition écrite, validée avec vous avant le démarrage de la mission.",
      chips: ["Comment ça se passe ?", "Être recontacté"],
    }),
  },
  {
    id: "emploi",
    k: [[/recrut|emploi|stage|stagiaire|candidature|\bcv\b|travailler chez|partenariat|partenaire/, 3]],
    answer: () => ({
      text: `Pour une candidature ou une proposition de partenariat, écrivez-nous à ${contactInfo.email} en précisant l'objet de votre message.`,
      links: [{ href: "/contact", label: "Page contact" }],
    }),
  },
  {
    id: "probleme",
    k: [[/probleme|reclamation|plainte|bug|erreur|ne marche pas|ne fonctionne pas|insatisfait/, 4]],
    answer: () => ({
      text: "Désolé pour ce désagrément. Décrivez-moi la situation et un consultant reviendra vers vous rapidement.",
      form: true,
    }),
  },
  {
    id: "securite-donnees",
    k: [[/hebergement|sauvegarde|piratage|fuite|chiffrement/, 3]],
    answer: () => ({
      text: "Vos documents sont partagés uniquement via votre espace client sécurisé, et vos données ne sont utilisées que pour votre mission.",
      links: [{ href: "/confidentialite", label: "Politique de confidentialité" }],
    }),
  },
];

export const FALLBACK: ChatAnswer = {
  text: "Je n'ai pas la réponse à cette question. Laissez vos coordonnées : votre question sera transmise à un consultant qui vous répondra sous 24 h ouvrées. Ou choisissez un sujet ci-dessous.",
  chips: ["Nos services", "Tarifs", "Comment ça se passe ?", "Espace client"],
  form: true,
};

/** Mots du domaine utilisés pour corriger les fautes de frappe (« tarfis » → « tarifs »). */
const VOCAB = [
  "tarifs", "prix", "devis", "delais", "duree", "services", "prestations", "tresorerie", "tableau", "tableaux", "business", "financement",
  "connexion", "connecter", "connecte", "contact", "contacter", "recontacter", "rendez-vous", "audit", "facture", "livrables", "horaires",
  "adresse", "telephone", "whatsapp", "demo", "article", "formation", "budget", "couts", "marge", "indicateurs", "consultant", "entreprise",
  "client", "espace", "references", "temoignages", "donnees", "confidentialite", "securite", "comment", "combien", "quand", "bonjour", "merci",
];

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // transposition de deux lettres (« tarfis »)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  return dp[a.length][b.length];
}

const strip = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Remplace les mots proches d'un mot du vocabulaire (1 faute pour 5+ lettres, 2 pour 8+). */
function correct(text: string): string {
  return text
    .split(/(\s+|[?!.,;:'"’]+)/)
    .map((tok) => {
      if (tok.length < 5 || VOCAB.includes(tok)) return tok;
      const max = tok.length >= 8 ? 2 : 1;
      return VOCAB.find((w) => Math.abs(w.length - tok.length) <= max && lev(tok, w) <= max) ?? tok;
    })
    .join("");
}

function best(text: string): { entry: Entry | null; score: number } {
  let entry: Entry | null = null;
  let score = 0;
  for (const e of KB) {
    const s = e.k.reduce((sum, [re, weight]) => sum + (re.test(text) ? weight : 0), 0);
    if (s > score) {
      entry = e;
      score = s;
    }
  }
  return { entry, score };
}

/** Réponse la plus pertinente pour un texte libre (mots-clés pondérés, fautes de frappe tolérées), ou le repli explicite. */
export function answerFor(text: string, ctx: Ctx): ChatAnswer {
  const plain = strip(text);
  const direct = best(plain);
  const fixed = best(correct(plain));
  const winner = fixed.score > direct.score ? fixed : direct;
  const answer = winner.entry ? winner.entry.answer(ctx) : FALLBACK;
  // La question posée est transmise avec la demande de rappel.
  return answer.form ? { ...answer, note: text } : answer;
}

export const QUICK_QUESTIONS = ["Nos services", "Tarifs", "Délais", "Être recontacté", "Parler sur WhatsApp"];
