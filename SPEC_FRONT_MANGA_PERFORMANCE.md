# Spécification Front — Plateforme MANGA PERFORMANCE

> Brief destiné à Claude Code. À placer à la racine du dépôt (ou à référencer depuis `CLAUDE.md`).
> Langue de l'interface : **français**. Langue du code (noms de variables, composants) : anglais.

---

## 0. Règles de travail (à respecter strictement)

1. **Travailler par étapes** (section 9). À la fin de chaque étape : s'arrêter, résumer ce qui a été fait, lister les fichiers créés/modifiés, et attendre validation avant de continuer.
2. **Front uniquement.** Aucun backend, aucune base de données, aucune API réelle. Toutes les données viennent de fixtures typées (section 3).
3. **coder rapidement les interfaces, les tester doivent être fait à la fin.
4. **Commits** : messages conventionnels (`feat:`, `fix:`, `chore:`…), en anglais. **Aucune mention d'attribution** (« Generated with Claude », `Co-Authored-By`, etc.) dans les commits ni dans les PR.
5. Avant chaque fin d'étape : `npm lint` et `npm typecheck` doivent passer sans erreur.
6. Ne pas installer de dépendance hors de la liste (section 2) sans le signaler et justifier.

---

## 1. Contexte

MANGA PERFORMANCE est un cabinet de conseil indépendant basé à Abidjan (Côte d'Ivoire), spécialisé en **Audit, Data et Contrôle de Gestion**. Consultant : MBA Audit & Contrôle de Gestion, 10+ ans d'expérience.

Le client a commandé une plateforme sur mesure regroupant 8 modules. **Objectif de cette phase : une maquette fonctionnelle cliquable** (données fictives) pour valider l'ergonomie et le périmètre avec le client avant le développement du backend.

Architecture cible : **une seule application** avec trois espaces :

| Espace | Route racine | Public | Contenu |
|---|---|---|---|
| Site public | `/` | Visiteurs | Site vitrine, blog, dashboard de démo, chatbot |
| Back-office | `/admin` | Consultant (rôle admin) | CRM, facturation, séquences email, scraper, blog, newsletter, clients |
| Espace client | `/espace-client` | Clients du cabinet | Livrables, messagerie, notifications |

Flux métier à rendre visible dans la maquette :
**formulaire du site / chatbot / scraper → prospect dans le CRM → statut « Client » → accès à l'espace client + facturation.**

---

## 2. Stack imposée

- **Next.js** (App Router) + **TypeScript** strict
- **Tailwind CSS** + **shadcn/ui** (composants) + **lucide-react** (icônes)
- **Recharts** (graphiques)
- **TanStack Table** (tableaux : tri, filtre, pagination)
- **react-hook-form** + **zod** (formulaires et validation)
- **TipTap** (éditeur d'articles du blog)
- **date-fns** avec locale `fr`
- **@dnd-kit** (kanban du CRM)
- Gestionnaire de paquets : **pnpm**

Pas de librairie d'état global au départ : état local + contexte React si nécessaire.

---

## 3. Couche de données (mock)

Objectif : pouvoir brancher l'API réelle plus tard **sans toucher aux composants**.

```
src/
  lib/
    types/          # types métier (section 4)
    mock/           # fixtures typées (.ts)
    services/       # fonctions async qui lisent les fixtures
```

- Les composants n'importent **jamais** `lib/mock` directement : uniquement `lib/services`.
- Chaque service retourne une `Promise` et simule une latence (150–400 ms) pour afficher les états de chargement.
- Les mutations (créer un prospect, changer un statut…) modifient un store en mémoire côté client. Elles ne persistent pas au rechargement, et c'est voulu.
- Prévoir les états **chargement / vide / erreur** sur chaque liste.

### Données fictives — règles

- Contexte ivoirien réaliste : entreprises fictives à Abidjan (Plateau, Cocody, Marcory, Zone 4, Treichville, Yopougon) et en intérieur (Bouaké, San-Pédro, Yamoussoukro).
- Secteurs : Hôtellerie, Santé (cliniques), Restauration, PME industrie, Commerce, BTP, Services.
- Téléphones au format `+225 07 XX XX XX XX`.
- Montants en **FCFA**, formatés `1 250 000 FCFA` (`Intl.NumberFormat('fr-FR')`, sans décimales).
- Dates au format `28 oct. 2026`.
- Aucune vraie entreprise, aucune vraie personne.
- Volumes : ~60 prospects, ~15 clients, ~40 factures, ~120 interactions, 3 séquences email, ~8 articles de blog, ~200 lignes de scraping.

---

## 4. Modèle de données (types TypeScript)

```ts
type ProspectStatus = 'nouveau' | 'en_negociation' | 'client' | 'perdu';
type ProspectSource = 'site_formulaire' | 'chatbot' | 'scraper' | 'newsletter' | 'manuel' | 'recommandation';
type CompanySize = 'tpe' | 'pme' | 'grande_entreprise';
type Need = 'business_plan' | 'tableau_de_bord' | 'tresorerie' | 'maitrise_couts' | 'audit' | 'autre';

interface Prospect {
  id: string;
  companyName: string;
  contactName: string;
  email?: string;
  phone?: string;
  sector: string;
  city: string;
  size: CompanySize;
  need: Need;
  status: ProspectStatus;
  source: ProspectSource;
  estimatedValue?: number;      // FCFA, pour le CA prévisionnel
  ownerNote?: string;
  createdAt: string;
  nextFollowUpAt?: string;      // prochaine relance
}

type InteractionType = 'email' | 'appel' | 'reunion' | 'note';
interface Interaction {
  id: string; prospectId: string; type: InteractionType;
  summary: string; date: string;
}

interface FollowUp {           // relance (rappel interne, J+7 / J+15 / J+30)
  id: string; prospectId: string; dueAt: string;
  rule: 'J+7' | 'J+15' | 'J+30' | 'manuel'; done: boolean;
}

type InvoiceStatus = 'brouillon' | 'emise' | 'payee' | 'en_attente' | 'en_retard' | 'annulee';
interface InvoiceLine { label: string; quantity: number; unitPrice: number; }
interface Invoice {
  id: string; number: string;            // format 2026-001
  fneNumber?: string;                    // numéro de Facture Normalisée Électronique (DGI)
  clientId: string; lines: InvoiceLine[];
  vatRate: number;                       // 0.18 par défaut
  issuedAt: string; dueAt: string; status: InvoiceStatus;
  remindersSent: number;
}

interface EmailSequence {
  id: string; name: string;
  trigger: 'inscription_newsletter' | 'manuel';
  steps: { order: number; delayDays: number; subject: string; body: string }[];
  active: boolean;
  stats: { enrolled: number; sent: number; opened: number; clicked: number; unsubscribed: number };
}

interface ScrapeJob {
  id: string; source: 'annuaire' | 'appels_offres' | 'site_web';
  filters: { sector?: string; city?: string; size?: CompanySize };
  status: 'en_cours' | 'termine' | 'echec';
  startedAt: string; resultsCount: number;
}
interface ScrapeResult {
  id: string; jobId: string; companyName: string; sector: string;
  address?: string; phone?: string; email?: string;
  importedToCrm: boolean; duplicateOf?: string;
}

interface Deliverable {
  id: string; clientId: string; title: string;
  fileType: 'pdf' | 'xlsx'; sizeKb: number; publishedAt: string; isNew: boolean;
}
interface Message {
  id: string; clientId: string; from: 'consultant' | 'client';
  body: string; sentAt: string; read: boolean;
}

interface BlogPost {
  id: string; slug: string; title: string; excerpt: string;
  category: 'controle_de_gestion' | 'data' | 'audit';
  content: string; coverImage?: string;
  status: 'brouillon' | 'publie'; publishedAt?: string;
  seo: { metaTitle?: string; metaDescription?: string };
}

interface NewsletterSubscriber {
  id: string; email: string; confirmed: boolean;   // double opt-in
  subscribedAt: string; unsubscribedAt?: string;
}
```

Données du dashboard de démo : jeu séparé `lib/mock/demo-dashboard.ts` (3 hôtels fictifs, 12 mois, produits : chambres, restauration, séminaires).

---

## 5. Design system

| Token | Valeur | Usage |
|---|---|---|
| `primary` | `#1A2B4A` (bleu nuit) | Header, sidebar, titres, boutons principaux |
| `accent` | `#F5B700` (jaune doré) | CTA, éléments actifs, mises en avant, graphiques |
| `background` | `#FFFFFF` | Fond |
| Neutres | gris froids (échelle Tailwind `slate`) | Textes secondaires, bordures |
| Sémantiques | vert / orange / rouge sobres | Statuts : payé, en attente, en retard, perdu |

- **Contraste** : le jaune `#F5B700` ne doit jamais porter du texte blanc. Sur fond jaune, utiliser du texte bleu nuit. Vérifier le contraste AA.
- Typographie : moderne, lisible, professionnelle. Proposition : **Plus Jakarta Sans** (titres) + **Inter** (texte), via `next/font`. À remplacer par celle de l'autre application du client si elle diffère.
- Définir les couleurs comme variables CSS shadcn (`--primary`, `--accent`…) dans `globals.css`.
- **Responsive obligatoire** : mobile (375 px), tablette (768 px), desktop (1280 px+). La sidebar du back-office devient un tiroir sur mobile. Les tableaux défilent horizontalement ou passent en cartes.
- Ton : sobre, « cabinet de conseil ». Pas d'effets gadgets.

---

## 6. Arborescence des routes

```
/                              Accueil
/a-propos
/services
/services/[slug]               business-plan-bancable | tableaux-de-bord-kpi | tresorerie | maitrise-des-couts
/references
/blog
/blog/[slug]
/demo                          Dashboard de démonstration (public)
/contact
/mentions-legales
/confidentialite

/admin                         Tableau de bord commercial
/admin/prospects               Liste + vue kanban
/admin/prospects/[id]          Fiche prospect
/admin/relances
/admin/clients
/admin/factures
/admin/factures/nouvelle
/admin/factures/[id]
/admin/sequences
/admin/sequences/[id]
/admin/scraper
/admin/scraper/[jobId]
/admin/blog
/admin/blog/nouveau
/admin/blog/[id]
/admin/newsletter
/admin/parametres

/espace-client/connexion
/espace-client                 Tableau de bord (livrables)
/espace-client/messages
/espace-client/notifications
```

Authentification **simulée** : un sélecteur de profil sur les pages de connexion (« Se connecter en tant que consultant / client X »). Pas de vraie auth.

---

## 7. Spécifications par écran

### 7.1 Site public

**Accueil**
- Hero : slogan « **Vos coûts vous échappent ? Pilotez-les.** », sous-titre, photo du consultant (placeholder), 2 CTA (« Prendre rendez-vous » et « Voir une démo »).
- Les 4 services en cartes, chacune avec un lien vers sa page.
- Chiffres clés (10+ ans, etc., en placeholders éditables).
- Aperçu des références et témoignages.
- Les 3 derniers articles du blog.
- Bloc d'inscription à la newsletter.

**À propos** : parcours, diplômes (MBA Audit & Contrôle de Gestion), expérience, approche.

**Services** et **pages service** : une page par service (pour le SEO), avec problème, approche, livrables, CTA.

**Références** : études de cas anonymisées (contexte → mission → résultats chiffrés) et témoignages. Les textes sont des placeholders marqués `[À fournir par le client]`.

**Blog** : liste, filtre par catégorie, page article, partage (LinkedIn, WhatsApp, copier le lien).

**Contact**
- Formulaire : Nom*, Email*, Téléphone, Secteur (liste), Besoin (liste), Message*.
- Validation zod, message de succès. En mock, l'envoi crée un prospect `source: 'site_formulaire'` dans le store, visible ensuite dans `/admin/prospects`.
- Case de consentement au traitement des données, avec lien vers la page confidentialité.
- Bouton WhatsApp (lien `wa.me` avec message prérempli).
- Coordonnées.
- Bloc de prise de rendez-vous : emplacement d'intégration Calendly, avec un placeholder visuel en mock.

**Éléments globaux du site**
- Header sticky.
- Footer avec liens légaux.
- Bouton WhatsApp flottant.
- **Widget chatbot** (7.4).

### 7.2 Dashboard de démonstration (`/demo`)

- **Bandeau visible** : « Données fictives — exemple de livrable MANGA PERFORMANCE ».
- **Filtres** : hôtel (3 + « Tous »), produit, période (mois / trimestre / année).
- **KPI en cartes** :
  - marge brute ;
  - CA par collaborateur ;
  - point mort (en FCFA et en date d'atteinte) ;
  - taux de satisfaction.
  
  Chaque carte affiche la variation par rapport à la période précédente.
- **Graphiques** :
  - évolution mensuelle du CA et des charges (lignes) ;
  - comparaison entre hôtels (barres) ;
  - tendance de la marge.
- **Analyse des écarts** : tableau coût prévu vs coût réalisé par poste, avec écart en valeur et en %, et mise en couleur.
  - Libellés provisoires : « CPro (prévisionnel) / CPra (pratiqué) ». **Ajouter un commentaire `TODO` : définitions et formules à confirmer par le client.**
  - Taux de couverture : à afficher, formule placeholder à confirmer.
- **Export PDF / Excel** : boutons présents. En mock, ils affichent un toast « Disponible dans la version finale ».
- **Capture de lead** : bouton « Je veux ce tableau de bord pour mon entreprise ». Il ouvre une modale (nom, email, entreprise, secteur) qui crée un prospect `source: 'site_formulaire'`.

### 7.3 Back-office (`/admin`)

**Layout** : sidebar bleu nuit avec la navigation suivante.

```
Tableau de bord
Commercial
  ├─ Prospects
  ├─ Relances
  └─ Clients
Facturation
Marketing
  ├─ Séquences
  ├─ Newsletter
  └─ Blog
Scraper
Paramètres
```

En haut : recherche globale et cloche de notifications (relances du jour).

**Tableau de bord commercial**
- **KPI** :
  - leads du mois ;
  - taux de conversion ;
  - CA prévisionnel (somme de `estimatedValue` des prospects en négociation) ;
  - factures en retard (montant).
- **Graphiques** :
  - leads par source ;
  - entonnoir par statut ;
  - CA encaissé par mois.
- **Listes** : relances à faire aujourd'hui, derniers prospects.

**Prospects**
- **Vue tableau**, avec colonnes entreprise, contact, secteur, ville, besoin, statut (badge), source, prochaine relance.
  - Filtres : statut, secteur, taille, besoin, source. C'est la segmentation demandée par le client.
  - Recherche plein texte.
  - Sélection multiple.
  - Export Excel / PDF (toast en mock).
- **Vue kanban** : 4 colonnes par statut, glisser-déposer pour changer de statut. Passer en « Client » propose de créer l'accès à l'espace client.
- Bouton « Nouveau prospect » : formulaire dans un panneau latéral.

**Fiche prospect**
- En-tête : identité, statut modifiable, valeur estimée.
- Onglet **Historique** : timeline des interactions (email, appel, réunion, note) avec icônes, et formulaire d'ajout rapide.
- Onglet **Relances** : relances planifiées (J+7 / J+15 / J+30), marquer comme faite, en ajouter une.
- Onglet **Factures** : visible si le prospect est client.
- Badge de source (scraper, chatbot…).

**Relances** : liste en trois groupes (en retard, aujourd'hui, à venir). Action « fait » et accès à la fiche.

**Clients** : liste des prospects au statut client, avec accès espace client (actif / inactif), nombre de livrables et CA facturé. Depuis un client, on peut **publier un livrable** (upload simulé) qui apparaît dans son espace.

**Facturation**
- **Liste** :
  - filtres par statut et par période ;
  - totaux (émis, encaissé, en retard) ;
  - badges de statut ;
  - action « Relancer », qui incrémente `remindersSent` et affiche un toast.
- **Création** :
  - choix du client ;
  - lignes de prestation dynamiques (libellé, quantité, prix unitaire) ;
  - TVA (18 % par défaut, modifiable) ;
  - calcul automatique HT / TVA / TTC ;
  - numérotation automatique `2026-0XX`.
- **Détail** : aperçu de la facture au format A4 (bleu nuit et doré), historique des statuts, champ **N° FNE**, export PDF (toast en mock).
- **Note FNE** : afficher dans l'écran de création un encart d'information neutre : « La facture fiscale doit être émise via la plateforme FNE de la DGI. Renseignez le numéro FNE une fois émise. » **Ne jamais présenter la facture générée comme conforme FNE.**

**Séquences email**
- **Liste** : séquences avec déclencheur, statut actif/inactif et statistiques (inscrits, envoyés, taux d'ouverture, taux de clic, désinscriptions).
- **Éditeur** :
  - étapes ordonnées (délai en jours, objet, corps) ;
  - variables de personnalisation insérables `{{prenom}}`, `{{entreprise}}`, `{{secteur}}`, `{{besoin}}` ;
  - aperçu avec un prospect exemple.
- 3 séquences fournies : Présentation → Étude de cas → Offre.
- Note visible dans les stats : « Le taux d'ouverture est indicatif. »

**Newsletter** : liste des abonnés (confirmé / en attente / désinscrit), compteurs, export.

**Blog (admin)** : liste des articles (brouillon / publié). Éditeur TipTap avec titre, catégorie, image de couverture, extrait, contenu, et champs SEO (meta title, meta description avec compteur de caractères). Boutons « Prévisualiser », « Enregistrer le brouillon », « Publier ».

**Scraper**
- **Nouveau job** :
  - source parmi : annuaires professionnels, sites d'appels d'offres, sites web d'entreprises. **Pas de LinkedIn** ;
  - filtres : secteur, ville, taille ;
  - en mock, lancement d'un job avec une progression simulée.
- **Historique des jobs** : statut, date, nombre de résultats.
- **Résultats d'un job** :
  - tableau avec doublons détectés (badge, lien vers le prospect existant) ;
  - champs manquants signalés (email absent, etc.) ;
  - sélection et **« Importer dans le CRM »**, qui crée des prospects `source: 'scraper'` ;
  - export CSV / Excel.
- Encart d'information : rappel de conformité (loi ivoirienne 2013-450, données publiques uniquement, respect des CGU des sources).

**Paramètres** :
- profil du cabinet (nom, coordonnées, logo) ;
- règles de relance (J+7 / J+15 / J+30 activables) ;
- paramètres de facturation (TVA par défaut, mentions, coordonnées bancaires en placeholder) ;
- message WhatsApp prérempli.

### 7.4 Chatbot (widget sur le site public)

- Bouton flottant en bas à droite, distinct du bouton WhatsApp. Les deux ne doivent pas se chevaucher : empiler ou fusionner en un menu.
- **Chatbot scripté**, sans IA, avec ce scénario :
  1. Message d'accueil.
  2. Choix proposés : Nos services / Tarifs / Délais / Être recontacté / Parler sur WhatsApp.
  3. Réponses prédéfinies, avec renvoi vers les pages concernées.
  4. Pour « Tarifs », ne jamais afficher de prix : proposer d'être recontacté.
  5. Capture de lead (nom, email ou téléphone, besoin), qui crée un prospect `source: 'chatbot'`.
- Indiquer « Réponses automatiques — un consultant vous recontacte sous 24 h ouvrées ».

### 7.5 Espace client (`/espace-client`)

- **Connexion** : formulaire email / mot de passe (simulé) et lien « mot de passe oublié » (écran seulement).
- **Tableau de bord** :
  - livrables sous forme de liste ou de cartes : titre, type PDF/XLSX, taille, date, badge « Nouveau » ;
  - bouton Télécharger (toast en mock) ;
  - filtre par type.
- **Messages** :
  - fil de discussion asynchrone avec le consultant (pas de temps réel) ;
  - zone de saisie et pièce jointe (simulée) ;
  - indicateur de lecture.
- **Notifications** : nouveaux livrables, nouveaux messages. Badge de compteur dans le header.
- Layout plus simple que l'admin : header avec le logo, le nom du client et la déconnexion.

---

## 8. Exigences transverses

- **Accessibilité** :
  - labels sur tous les champs ;
  - focus visible ;
  - navigation au clavier sur kanban, modales et menus ;
  - `alt` sur les images.
- **SEO du site public** :
  - `metadata` par page ;
  - `sitemap.ts`, `robots.ts` ;
  - données structurées JSON-LD `ProfessionalService` sur l'accueil ;
  - Open Graph.
- **Performance** : `next/image`, polices via `next/font`, pas de librairie lourde non listée.
- **Composants réutilisables** : `KpiCard`, `StatusBadge`, `DataTable`, `PageHeader`, `EmptyState`, `MoneyAmount`, `DateLabel`.
- **Utilitaires** : `formatFCFA()`, `formatDate()`, `formatPhoneCI()` dans `lib/utils/format.ts`.
- Chaque fonctionnalité non opérationnelle en mock (export, téléchargement, envoi) affiche un **toast explicite**, jamais un bouton mort.

---

## 9. Plan d'exécution (s'arrêter et attendre validation à chaque étape)

| Étape | Contenu | Critère de fin |
|---|---|---|
| **1. Socle** | Init Next.js + dépendances, design tokens, polices, layouts des 3 espaces, navigation, types, couche services + fixtures, utilitaires de format, auth simulée | Les 3 espaces naviguent, données mock chargées |
| **2. Site public** | Toutes les pages publiques, formulaire de contact, WhatsApp, newsletter, blog public, SEO | Site complet et responsive |
| **3. Dashboard démo** | `/demo` complet avec filtres, KPI, graphiques, écarts, capture de lead | Filtres fonctionnels sur les données mock |
| **4. CRM** | Dashboard admin, prospects (tableau + kanban), fiche, relances, clients | Flux formulaire → prospect → client visible |
| **5. Facturation** | Liste, création avec calculs, détail A4, relances | Calculs HT / TVA / TTC justes |
| **6. Espace client** | Connexion, livrables, messages, notifications, publication de livrable depuis l'admin | Un livrable publié en admin apparaît côté client |
| **7. Marketing** | Blog admin (TipTap), newsletter, séquences email | Création / édition fonctionnelles |
| **8. Scraper + chatbot** | Écrans scraper avec import CRM et doublons, widget chatbot scripté | Imports et leads du chatbot visibles dans le CRM |
| **9. Finition** | Revue responsive des 3 breakpoints, accessibilité, états vides / erreurs, nettoyage | Lint + typecheck OK, revue visuelle |

---

## 10. Hors périmètre de cette phase

Backend, base de données, vraie authentification, envoi réel d'emails, intégration FNE / DGI, scraping réel, intégration Calendly réelle, génération réelle de PDF / Excel, stockage de fichiers, déploiement.

## 11. Points en attente de confirmation client

À garder en `TODO` dans le code, sans bloquer le développement :

- Formules exactes des KPI du dashboard (CPro, CPra, taux de couverture, point mort).
- Relances CRM : rappel interne uniquement, ou aussi email automatique au prospect ?
- Newsletter : envoi automatique de chaque nouvel article ou envois manuels ?
- Langue : français uniquement, ou aussi l'anglais ?
- Contenus définitifs : photo, textes, études de cas, témoignages réels et autorisés.
