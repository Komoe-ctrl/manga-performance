/**
 * The three template sequences created by `pnpm db:seed` (spec, section 12). They start
 * inactive: the consultant reviews and personalises them before switching them on.
 *
 * Plain text with the allowed variables ({{prenom}}, {{entreprise}}, {{secteur}},
 * {{besoin}}); blank lines separate paragraphs.
 * TODO(client): validate the wording and the cabinet's commitments (spec, section 14).
 */
export interface SequenceTemplate {
  name: string;
  trigger: "inscription_newsletter" | "manuel";
  steps: { delayDays: number; subject: string; body: string }[];
}

export const SEQUENCE_TEMPLATES: SequenceTemplate[] = [
  {
    name: "Bienvenue — nouveaux abonnés",
    trigger: "inscription_newsletter",
    steps: [
      {
        delayDays: 0,
        subject: "Bienvenue chez MANGA PERFORMANCE",
        body: "Bonjour {{prenom|cher abonné}},\n\nMerci de vous être inscrit(e) à notre newsletter. Nous accompagnons les PME et les entreprises d'Abidjan et de Côte d'Ivoire en audit, data analytique et contrôle de gestion.\n\nVous recevrez de temps en temps des conseils concrets pour piloter vos coûts et votre trésorerie, sans jargon.\n\nÀ très bientôt,\nL'équipe MANGA PERFORMANCE",
      },
      {
        delayDays: 3,
        subject: "Trois chiffres à suivre chaque semaine dans {{entreprise|votre entreprise}}",
        body: "Bonjour {{prenom|cher abonné}},\n\nPour {{entreprise|votre entreprise}}, trois indicateurs suffisent souvent à garder le cap : la trésorerie disponible, les encaissements attendus et les dépenses engagées.\n\nUn tableau de bord simple, mis à jour chaque semaine, évite bien des mauvaises surprises en fin de mois.\n\nSi vous voulez en discuter, répondez simplement à cet email.\n\nL'équipe MANGA PERFORMANCE",
      },
      {
        delayDays: 10,
        subject: "Un échange de 30 minutes sur {{besoin|vos besoins}} ?",
        body: "Bonjour {{prenom|cher abonné}},\n\nSi {{besoin|le pilotage de votre activité}} fait partie de vos priorités, nous pouvons en parler lors d'un échange de 30 minutes, sans engagement.\n\nVous pouvez prendre rendez-vous depuis notre site ou répondre directement à cet email.\n\nL'équipe MANGA PERFORMANCE",
      },
    ],
  },
  {
    name: "Suivi après un premier contact",
    trigger: "manuel",
    steps: [
      {
        delayDays: 0,
        subject: "Suite à notre échange, {{prenom|bonjour}}",
        body: "Bonjour {{prenom|cher contact}},\n\nMerci pour l'échange concernant {{entreprise|votre entreprise}}. Pour rappel, nous pouvons vous accompagner sur {{besoin|vos besoins}}.\n\nN'hésitez pas à revenir vers nous avec vos questions.\n\nCordialement,\nL'équipe MANGA PERFORMANCE",
      },
      {
        delayDays: 4,
        subject: "Une ressource pour le secteur {{secteur|de votre activité}}",
        body: "Bonjour {{prenom|cher contact}},\n\nNous avons préparé quelques repères utiles pour les entreprises du secteur {{secteur|de votre activité}} : suivi des coûts, marges et trésorerie.\n\nSouhaitez-vous que nous les passions en revue ensemble ?\n\nCordialement,\nL'équipe MANGA PERFORMANCE",
      },
      {
        delayDays: 10,
        subject: "Où en êtes-vous, {{prenom|bonjour}} ?",
        body: "Bonjour {{prenom|cher contact}},\n\nNous revenons vers vous une dernière fois au sujet de {{entreprise|votre entreprise}}. Si le sujet n'est plus d'actualité, ne tenez pas compte de ce message et vous ne recevrez plus de relance.\n\nSinon, nous restons disponibles quand vous le souhaitez.\n\nCordialement,\nL'équipe MANGA PERFORMANCE",
      },
    ],
  },
  {
    name: "Réactivation — prospects en sommeil",
    trigger: "manuel",
    steps: [
      {
        delayDays: 0,
        subject: "Cela fait un moment, {{prenom|bonjour}}",
        body: "Bonjour {{prenom|cher contact}},\n\nNous n'avons pas échangé depuis un moment. Où en est {{entreprise|votre entreprise}} sur {{besoin|vos sujets de pilotage}} ?\n\nSi cela peut vous aider, nous pouvons refaire le point en quelques minutes.\n\nCordialement,\nL'équipe MANGA PERFORMANCE",
      },
      {
        delayDays: 7,
        subject: "Dernier message de notre part",
        body: "Bonjour {{prenom|cher contact}},\n\nSans nouvelle de votre part, nous n'insisterons pas. Si votre situation évolue, vous pouvez nous écrire à tout moment : nous serons ravis de vous accompagner.\n\nCordialement,\nL'équipe MANGA PERFORMANCE",
      },
    ],
  },
];
