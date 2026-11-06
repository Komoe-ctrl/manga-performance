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
