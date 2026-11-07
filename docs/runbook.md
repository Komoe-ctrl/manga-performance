# Runbook d'exploitation

Public : la personne qui déploie et exploite le VPS. Tout ce qui suit a été exécuté au moins une fois en local
(sauf mention contraire) ; la recette sur le VPS est l'étape finale de validation.

## 1. Première installation

Prérequis sur le VPS : Docker et Docker Compose, un nom de domaine dont l'enregistrement DNS `A` pointe vers le
serveur, les ports 80 et 443 ouverts (aucun autre port n'est publié).

1. Récupérer le dépôt, puis `cp infra/.env.production.example infra/.env.production`.
2. Remplir **toutes** les valeurs. Générer chaque secret avec `openssl rand -base64 48`. L'application refuse de
   démarrer en production si une valeur contient encore `change-me`, ou si la clé Turnstile est une clé de test.
3. Créer le bucket S3 **privé** (OVH, Scaleway, R2…). Le préfixe `public/blog/` est le seul à rendre public en
   lecture (voir `pnpm storage:setup` pour la politique et le CORS).
4. Démarrer : `docker compose -f infra/docker-compose.yml --env-file infra/.env.production up -d --build`.
   Le conteneur `web` applique les migrations (`prisma migrate deploy`) avant de lancer le serveur ; Caddy obtient
   le certificat HTTPS tout seul au premier accès.
5. Créer l'administrateur initial (une seule fois, aucune donnée fictive) :
   `docker compose -f infra/docker-compose.yml --env-file infra/.env.production exec web pnpm db:seed`.
   Le lien d'invitation affiché est à usage unique (72 h) : il sert à choisir le mot de passe et à enrôler la 2FA.
6. Vérifier : `https://<domaine>/api/health` répond `{"status":"ok","database":"up","worker":"up"}`.

## 2. Supervision

- `GET /api/health` : 200 si la base répond **et** que le worker a battu moins de 2 minutes plus tôt (503 sinon).
  À brancher sur une sonde externe (UptimeRobot, Better Stack…).
- Logs JSON : `docker compose -f infra/docker-compose.yml logs -f web worker scraper`. Les mots de passe, jetons et
  contenus de messages n'y figurent jamais ; emails et téléphones sont masqués.
- Sentry est optionnel et désactivé par défaut.

## 3. Mise à jour

```bash
git pull
docker compose -f infra/docker-compose.yml --env-file infra/.env.production up -d --build
```

Les migrations sont appliquées au démarrage de `web`. Avant une mise à jour qui contient une migration, faire une
sauvegarde manuelle (section 4). Retour arrière : revenir au commit précédent et reconstruire ; une migration déjà
appliquée ne se défait pas, on restaure la sauvegarde (section 5).

## 4. Sauvegardes

- Le service `backup` exécute `pg_dump` **chaque jour à 02:30 (Africa/Abidjan)**, chiffre le dump (AES-256, clé
  dérivée de `BACKUP_PASSPHRASE`) **avant** l'envoi, et le dépose dans le bucket sous `backups/manga-<date>.dump.enc`.
- Rétention : 30 jours (les sauvegardes plus anciennes sont supprimées à chaque exécution).
- Sauvegarde manuelle immédiate :
  `docker compose -f infra/docker-compose.yml --env-file infra/.env.production exec backup backup.sh`
- **Conserver `BACKUP_PASSPHRASE` hors du serveur** (gestionnaire de mots de passe). Sans elle, une sauvegarde est
  inutilisable ; avec elle seule, personne ne peut lire les données sans accès au bucket.
- Les fichiers (livrables, pièces jointes) sont déjà dans le bucket : activer le versionnage et/ou la réplication
  chez le fournisseur pour les protéger.

## 5. Restauration

**Toujours vérifier d'abord dans une base temporaire** (aucun impact sur la production) :

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env.production exec backup restore.sh latest
# ou une sauvegarde précise : restore.sh backups/manga-20261107T023001Z.dump.enc
```

Le script déchiffre, restaure dans la base `manga_restore` (recréée à chaque fois) et liste les tables non vides.
Une mauvaise phrase de passe fait échouer le déchiffrement avant toute écriture.

**Restauration réelle** (sinistre) :

1. Arrêter ce qui écrit : `docker compose ... stop web worker scraper`.
2. `docker compose ... exec backup restore.sh latest --into-production`
   (écrase le contenu de la base `manga`).
3. Redémarrer : `docker compose ... up -d`, puis contrôler `/api/health` et se connecter au back-office.

Test réalisé le 07/11/2026 sur la pile de développement : sauvegarde de 110 Ko envoyée au stockage objet, restauration
dans une base temporaire (`_prisma_migrations`, `User`, `EmailSequence`… retrouvées), échec correct avec une mauvaise
phrase de passe, suppression d'une sauvegarde de 40 jours par la rétention. **À refaire sur le VPS à la recette.**

## 6. Incidents courants

| Symptôme | Cause probable | Action |
| --- | --- | --- |
| `/api/health` renvoie `worker: down` | Le worker est arrêté ou ne joint pas la base | `logs worker`, puis `restart worker` |
| Aucun email envoyé | Clé Brevo invalide, ou worker arrêté | `logs worker` ; vérifier `BREVO_API_KEY` ; les emails en échec sont rejoués par pg-boss |
| Le web ne démarre pas | Variable manquante ou valeur factice (message listant les **noms** concernés) | Corriger `infra/.env.production`, `up -d` |
| Certificat HTTPS non émis | DNS pas encore propagé, ports 80/443 fermés | Vérifier le DNS et le pare-feu, `logs caddy` |
| Collecte de données en échec | Site source qui bloque (403/429/CAPTCHA) : arrêt volontaire | Ne pas contourner ; voir le message d'erreur du job dans le back-office |
| Un client dit ne plus recevoir d'emails | Adresse dans la liste d'exclusion (désinscription, rebond) | Vérifier la table `Suppression` ; ne retirer qu'avec son accord |

## 7. Droits sur les données personnelles

Depuis la fiche prospect : **Exporter les données** (JSON complet) et **Anonymiser** (irréversible ; les factures sont
conservées). Voir le README, section « Exports et données personnelles ». Chaque action est inscrite dans le journal
d'audit. La déclaration auprès de l'ARTCI et les textes juridiques relèvent du client.

## 8. Rotation des secrets

- `INTERNAL_API_TOKEN` / `INTERNAL_API_HMAC_SECRET` : changer dans `.env.production`, puis `up -d` (web et scraper
  doivent recevoir la même valeur).
- `BETTER_AUTH_SECRET` : déconnecte tout le monde (sessions invalidées).
- `TRACKING_HMAC_SECRET` : invalide les anciens liens de désinscription et de suivi des emails déjà envoyés.
- `BACKUP_PASSPHRASE` : les nouvelles sauvegardes utilisent la nouvelle ; **conserver l'ancienne** tant que des
  sauvegardes chiffrées avec elle existent (30 jours).
