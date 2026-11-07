# MANGA PERFORMANCE

Monorepo pnpm : site public, admin et espace client (`apps/web`), worker de jobs (`apps/worker`),
paquets partagés (`packages/*`). Spécifications : `SPEC_FRONT_MANGA_PERFORMANCE.md`
et `SPEC_BACKEND_MANGA_PERFORMANCE.md`.

## Démarrage

```bash
pnpm install
cp .env.example .env          # puis remplacer les secrets (openssl rand -base64 48)
pnpm db:up                    # PostgreSQL 16 de dev, port 5434
pnpm db:deploy                # applique les migrations
pnpm dev                      # web (http://localhost:3000) + worker
```

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm dev` | web + worker en mode développement |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | contrôles exécutés par la CI |
| `pnpm db:up` / `pnpm db:down` | démarrer / arrêter PostgreSQL de dev |
| `pnpm db:migrate` | créer une migration après modification du schéma Prisma |
| `pnpm db:deploy` | appliquer les migrations existantes |
| `pnpm db:seed` | seed (vide pour l'instant) |

Les variables d'environnement sont validées au démarrage (`packages/core/src/env.ts`).

## Authentification (étape 2)

- Better Auth (`apps/web/src/server/auth`), routes sous `/api/auth/*`. Pas d'inscription publique : le
  consultant est créé par `pnpm db:seed` (lien d'activation à usage unique affiché dans le terminal),
  les clients sont invités depuis l'admin.
- Chaque Server Action ou Route Handler protégé commence par `requireAdmin()` ou `requireClient()`
  (`server/auth/guards.ts`). Les requêtes de l'espace client passent par `clientScope(session)`.
- Les tests d'intégration (`pnpm test`) ont besoin de PostgreSQL (`pnpm db:up`) et utilisent la base
  `manga_test`, jamais la base de dev.

## Mode de données et leads (étapes 3 et 4)

- `DATA_SOURCE=mock` (défaut) : le front tourne sur les données fictives. `DATA_SOURCE=db` : CRM,
  clients, paramètres et formulaires publics passent par la base. Relancer le serveur après changement.
- Les formulaires publics (contact, chatbot, démo) envoient `POST /api/leads` : Turnstile vérifié côté
  serveur, champ piège, 5 envois/heure/IP, validation stricte, dédoublonnage (un contact existant reçoit
  une note, pas un doublon), consentement enregistré, notification du consultant.
- En local, `.env.example` fournit les clés de test publiques de Cloudflare (toujours valides). Elles
  sont refusées en production, tout comme les valeurs `change-me`.

## Emails et jobs (étape 5)

- `apps/worker` traite les jobs pg-boss (PostgreSQL, pas de Redis) : `email.send` (3 tentatives, backoff
  exponentiel), `notifications.fanout` (notifications in-app + email, idempotent) et
  `followups.daily-digest` (tous les jours à 07:00, Africa/Abidjan). Le web ne fait que publier des jobs.
- Templates React Email en français dans `packages/emails` (bleu nuit et jaune, version texte, coordonnées
  du cabinet en pied de mail). Les emails contenant un lien à usage unique ne restent qu'une heure dans la
  table des jobs une fois traités.
- En développement, tant que `BREVO_API_KEY` vaut `change-me`, les emails sont écrits dans `.dev-mailbox/`
  (ouvrir le `.html` dans un navigateur) au lieu d'être envoyés. Avec une vraie clé Brevo, ils partent
  vraiment. `pnpm dev` lance le web et le worker.
- `pnpm test` exécute les paquets l'un après l'autre : web et worker partagent la base `manga_test`.

## Facturation (étape 6)

- Montants en FCFA entiers, quantités en centièmes, TVA en points de base ; tous les calculs sont dans
  `packages/core/src/invoice.ts` (TVA arrondie une seule fois sur le total). Le serveur recalcule toujours
  les totaux, ceux du navigateur sont ignorés.
- Cycle : brouillon (modifiable, sans numéro) → émission (numéro `AAAA-NNN` sans trou, y compris avec des
  émissions simultanées) → facture immuable. Une correction passe par un avoir (facture négative liée, un
  seul par facture) puis une nouvelle facture (`duplicateAsDraft`).
- L'immuabilité est aussi garantie par PostgreSQL (triggers de la migration `invoice_immutability`) :
  aucune requête, même manuelle, ne peut modifier ou supprimer une facture émise ni ses lignes.
- PDF à la demande : `GET /api/invoices/:id/pdf` (admin, ou client propriétaire hors brouillon). Il affiche
  le n° FNE s'il est renseigné et rappelle qu'il ne s'agit jamais d'une facture normalisée. Aucune
  intégration à l'API de la DGI : `ManualFneProvider` garde simplement le numéro saisi.
- Worker : `invoices.mark-overdue` (06:00), `followups.daily-digest` (07:00), `invoices.payment-reminders`
  (09:00, relances à J+3, J+10 et J+20 après l'échéance, 3 au maximum, journalisées).

## Espace client (étape 7)

- Stockage compatible S3 (bucket **privé**), MinIO en local : `pnpm db:up` démarre PostgreSQL et MinIO
  (API sur le port 9100, console sur 9101). Les fichiers n'en sortent que par des URL présignées.
- Envoi en deux temps : `requestUpload` contrôle nom, type et taille (25 Mo max ; PDF, XLSX, DOCX, PNG, JPG)
  et renvoie une URL PUT dont la signature **inclut la taille et le type exacts** ; une fois le fichier
  envoyé, le serveur le relit (taille, signature réelle du fichier, SHA-256) et le supprime s'il ne
  correspond pas à son extension. Clés : `clients/{clientId}/{aléatoire}.{ext}`.
- Téléchargement : `GET /api/deliverables/:id/download` et `GET /api/messages/:id/attachment` vérifient
  les droits, journalisent, puis redirigent vers une URL présignée de 5 minutes (`attachment`). Le
  fichier d'un autre client est indiscernable d'un fichier inexistant (404).
- Livrables, messages (l'email de notification ne contient jamais le message) et notifications
  (liste paginée, marquer comme lu, compteur) sont filtrés par le `clientId` de la session, jamais par
  celui du navigateur.
- Avec un fournisseur réel (OVH, R2), il faudra configurer le CORS du bucket pour autoriser le `PUT` depuis
  l'adresse du site (voir le runbook, étape 11).

## Marketing (étape 8)

- **Blog** : le JSON TipTap est la source de vérité ; le HTML est généré **et assaini** (liste blanche stricte,
  `sanitize-html`) à chaque enregistrement. Slug translittéré et unique, figé une fois l'article publié.
  Publier, modifier un article publié ou le supprimer rafraîchit `/blog`, l'article, l'accueil et le sitemap
  (`revalidatePath`). Les couvertures PNG/JPG vont sous `public/blog/`, **seul préfixe public** du bucket
  (`pnpm storage:setup` applique la politique de lecture ; le reste reste privé).
- **Newsletter** en double opt-in (`POST /api/newsletter/subscribe`, lien de confirmation à usage unique de 48 h),
  désinscription en un clic par lien signé (`List-Unsubscribe` + `List-Unsubscribe-Post`). Une confirmation crée
  ou relie un prospect de source NEWSLETTER et l'inscrit aux séquences actives « inscription newsletter ».
- **Séquences** : `sequences.dispatch` (toutes les 15 min) envoie l'étape due derrière les garde-fous (liste
  d'exclusion, fenêtre lundi-vendredi 08:00-18:00, plafond quotidien, 50 par défaut). Variables `{{prenom}}`,
  `{{entreprise}}`, `{{secteur}}`, `{{besoin}}` avec repli (`{{prenom|cher client}}`) ; les variables inconnues
  sont refusées à l'enregistrement. `pnpm db:seed` crée les 3 séquences modèles, inactives.
- **Suivi et webhooks** : pixel d'ouverture `/api/t/o/:id`, clics `/api/t/c/:id` (identifiants signés HMAC),
  webhook fournisseur `/api/webhooks/email` (signature vérifiée). Voir `docs/deliverability.md`.

## Scraper (étape 9)

- **Flux** : l'admin crée une collecte (`/admin/scraper`) → job `QUEUED` ; le service Python (`apps/scraper`) le
  réclame (`GET /api/internal/scrape-jobs/next`, atomique `SKIP LOCKED`), envoie les résultats par lots de 100 max
  (`POST …/:id/results`) et clôt le job (`PATCH …/:id`). Les résultats sont dédoublonnés à l'arrivée (email,
  téléphone, nom proche) contre le même job **et** le CRM ; l'import en prospect (source « scraper ») reste une
  action manuelle de l'admin, sans séquence email automatique.
- **API interne** : `X-Internal-Token` + signature HMAC-SHA256 de `timestamp.nonce.MÉTHODE.chemin.sha256(corps)`,
  fenêtre de ±300 s, rejeu refusé. Les vecteurs de test sont partagés TS/Python. En production, Caddy doit en
  plus restreindre `/api/internal/*` au réseau Docker (étape 11).
- **Règles de collecte** appliquées dans le code (`apps/scraper/scraper/policy.py`) : robots.txt respecté, 2 à 5 s
  entre requêtes, User-Agent identifiable, liste blanche de domaines (vide = rien n'est collecté), LinkedIn
  toujours interdit, aucun contournement : au premier 403/429/CAPTCHA, arrêt et job en échec.
- **Lancer** (voir `apps/scraper/README.md`) : `cd apps/scraper && python -m venv .venv && .venv/Scripts/pip install -e ".[dev]"`,
  puis `python -m scraper` (boucle) ou `python -m scraper --once`. Tests : `python -m pytest`.
- Seul un spider de démonstration existe ; les vraies sources sont ajoutées une à une après validation du client
  (conformité à la charge du client).

## Exports et données personnelles (étape 10)

- **Exports Excel / PDF** : `GET /api/exports/{prospects|invoices|subscribers|scrape-results}?format=xlsx|pdf&<filtres>`.
  Le Route Handler appelle `requireAdmin()`, **réapplique les filtres côté serveur** (mêmes règles que les écrans),
  renvoie le fichier en flux continu et écrit une ligne `export.generated` dans `AuditLog` (type, format, filtres,
  nombre de lignes). Excel (`exceljs`) : en-têtes figées, filtre automatique, onglet « Filtres », toutes les
  valeurs sont des cellules texte (jamais de formule, donc pas d'injection `=…`). PDF (`@react-pdf/renderer`,
  paysage, charte navy/or). Limites : 20 000 lignes, 2 000 pour le PDF (au-delà : affiner les filtres ou Excel).
  Les dates sont affichées en Africa/Abidjan. En mode `mock`, les boutons gardent leur message d'information.
- **Export RGPD d'un contact** (fiche prospect → « Exporter les données ») : JSON complet (fiche, historique,
  relances, séquences, événements email, newsletter, liste d'exclusion, résultats de scraping, espace client,
  factures, messages). Ni mots de passe, ni jetons, ni adresse IP.
- **Anonymisation** (fiche prospect → « Anonymiser », confirmation explicite, **irréversible**) : nom, contact,
  email, téléphone, ville, notes, consentement effacés ; historique et notes de relance remplacés ; séquences
  arrêtées ; abonnement newsletter supprimé ; événements email et résultats de scraping dépersonnalisés ;
  accès à l'espace client détruit (sessions, mot de passe, 2FA, notifications) ; messages vidés et pièces jointes
  supprimées du stockage. **Conservés** : les factures et paiements avec la raison sociale, l'adresse et le NCC
  de l'entreprise (obligation comptable), et, si la personne s'était désinscrite ou avait rebondi, une **empreinte SHA-256**
  de son adresse sur la liste d'exclusion (jamais l'adresse elle-même) : elle ne reçoit plus jamais d'email marketing.
  Le journal d'audit ne contient que des compteurs.

- **Exports de la démo** (`GET /api/exports/demo`, Excel et PDF) : publics car la page l'est, ils ne servent que le jeu
  de données fictif et les mêmes formules que l'écran (hôtel, produit, période). Limités à 20 par heure et par IP.
- **Données d'exemple en développement** : `pnpm db:seed:dev` crée 6 prospects, un client et 2 factures numérotées sans
  trou. Refusé en production, refusé hors base locale, et refusé si la base contient déjà des prospects ou des factures.

## Production, e2e et sécurité (étape 11)

- **Déploiement** : `infra/docker-compose.yml` (caddy, web, worker, scraper, postgres, backup). Seul Caddy publie les
  ports 80 et 443, et il répond 404 à `/api/internal/*` depuis Internet. Variables : `infra/.env.production.example`.
  Migrations appliquées au démarrage de `web`. `GET /api/health` : base + worker (battement toutes les 30 s).
- **Sauvegardes** : `pg_dump` quotidien chiffré vers le stockage objet, rétention 30 jours, restauration testée
  (`restore.sh`). Voir **`docs/runbook.md`** (installation, mise à jour, restauration, incidents, rotation des secrets).
- **Tests e2e (Playwright)** : `pnpm db:up` puis `pnpm e2e`. Base jetable `manga_e2e`, serveur Next et worker réels :
  formulaire de contact → prospect en admin ; conversion → invitation → connexion client → téléchargement d'un
  livrable ; facture créée → émise → payée. Nécessite Internet (clés de test Turnstile).
- **Revue de sécurité** : `docs/security-review.md`. Un test statique (`guard-coverage.test.ts`) échoue si un endpoint
  est ajouté sans garde d'autorisation.
