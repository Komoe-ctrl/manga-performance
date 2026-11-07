# Revue de sécurité finale (étape 11)

Date : 07/11/2026. Périmètre : tout le dépôt à la fin de l'étape 11. Méthode : relecture par thème de la section 5
de la spec, vérifications automatisées (tests, audit des dépendances), essais manuels de bout en bout.

## Résultat

Aucune faille bloquante trouvée. Un point corrigé pendant la revue, deux dépendances vulnérables neutralisées, quatre
points à valider ou à surveiller (en fin de document).

## Contrôles par thème

| Thème (spec §5) | Constat | Preuve |
| --- | --- | --- |
| Autorisation côté serveur | Chaque Server Action et chaque Route Handler protégé appelle `requireAdmin` / `requireClient` avant toute lecture. Les entrées publiques sont une liste courte et relue, chacune avec sa protection propre. | `test/guard-coverage.test.ts` (91 vérifications, échoue si un nouvel endpoint oublie son garde) ; tests par module |
| Isolation client A / client B | Les requêtes de l'espace client prennent `clientId` dans la session (`clientScope`), jamais du navigateur. Une ressource d'un autre client répond 404. | `test/isolation.test.ts`, `client-space*.test.ts` |
| Admin refusé à un client, 2FA admin | Un client reçoit 403 sur toutes les actions et routes admin ; un admin sans 2FA est refusé. | `crm-actions`, `exports`, `privacy`, `scraper-actions`, e2e (`403` sur `/api/exports`) |
| Authentification | argon2id, 2FA TOTP obligatoire pour l'admin, verrouillage 5 échecs / 15 min, limitation de débit, durée de session bornée. Cookies de session `Secure` en production (rendu explicite pendant la revue). | `login-security`, `two-factor`, `guards` |
| API interne (scraper) | Token + signature HMAC avec horodatage (±300 s) et anti-rejeu ; toute erreur renvoie le même 401. **En production, Caddy répond 404 à `/api/internal/*` depuis Internet** : le scraper passe par le réseau Docker. | `scraper.test.ts`, vecteurs partagés TS/Python, `infra/Caddyfile` |
| Webhooks | Refusés sans signature valide (Bearer ou HMAC). | `sequences-tracking.test.ts` |
| Formulaires publics | Turnstile vérifié côté serveur, honeypot, 5 par heure et par IP, validation zod stricte, réponses génériques. Les clés de test Cloudflare sont refusées en production. | `leads`, `newsletter`, `turnstile`, `core/env` |
| IP du client | Caddy remplace `X-Forwarded-For` par l'adresse réelle : les limites de débit ne se contournent pas avec un en-tête forgé. | `infra/Caddyfile` |
| Fichiers | URL présignées (10 min en dépôt, 5 min en lecture), taille et type signés, vérification après dépôt (signature binaire + SHA-256), stockage privé, seul `public/blog/` est public (images). | `client-space.test.ts`, `storage.minio.test.ts` |
| Contenu riche | HTML du blog assaini à l'enregistrement (liste blanche stricte) ; le seul `dangerouslySetInnerHTML` non statique affiche ce HTML assaini ou l'aperçu de l'admin lui-même. | `blog.test.ts` |
| En-têtes | CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` ; HSTS posé par Caddy. | `security-headers.test.ts`, `infra/Caddyfile` |
| Exports | Admin seul, filtres revalidés côté serveur, journalisés ; valeurs écrites comme texte (pas d'injection de formule Excel). | `exports.test.ts` |
| Données personnelles | Consentement enregistré, export JSON, anonymisation irréversible, journal sans donnée identifiante. | `privacy.test.ts` |
| Secrets | Aucun secret dans le dépôt ; variables validées au démarrage ; valeurs factices refusées en production ; erreurs d'environnement qui ne citent que les **noms**. Logs sans mot de passe, jeton ni contenu de message. | `core/env.test.ts`, relecture des logs |
| Conteneurs | Image applicative exécutée en utilisateur non root ; seul Caddy publie des ports ; PostgreSQL n'est pas exposé. | `infra/docker-compose.yml` |
| Sauvegardes | Chiffrées avant envoi, restauration testée, mauvaise clé refusée. | `docs/runbook.md` §4-5 |

## Dépendances

`pnpm audit --prod` au début de la revue : 4 alertes.

- `happy-dom` (2 alertes **hautes**, via `@tiptap/html`, utilisé pour produire le HTML du blog à partir du JSON de
  l'éditeur) : forcé en `>=21.0.4` (`overrides` dans `pnpm-workspace.yaml`). Tests du blog verts après la mise à jour.
- `uuid` (modérée, via `exceljs`) : forcé en `>=11.1.1`. Tests d'export verts.
- `deepmerge` (faible, sans correctif publié, via `html-to-text` dans le rendu des emails) : **acceptée**. Elle ne
  concerne que du contenu que nous générons nous-mêmes.

L'audit devrait être relancé à chaque mise à jour de dépendances (`pnpm audit --prod`).

## Corrigé pendant la revue

- Les cookies de session sont désormais `Secure` de façon explicite en production, au lieu de dépendre de l'inférence
  à partir de l'URL.

## Points à valider ou à surveiller

1. **Liste d'exclusion et anonymisation** : après anonymisation, une personne désinscrite reste exclue sous la forme
   d'une empreinte SHA-256 de son adresse (jamais l'adresse). C'est une pseudonymisation, pas un effacement total :
   une adresse connue peut être comparée à l'empreinte. À faire confirmer par le client (base légale : ne pas
   recontacter quelqu'un qui l'a demandé).
2. **Scraper** : la conformité (sources, cadre légal de la collecte et de la prospection) reste à la charge du client ;
   aucune source réelle n'est livrée, seulement un spider de démonstration.
3. **Turnstile en e2e** : les tests de bout en bout simulent la vérification Turnstile avec un serveur local (la variable `TURNSTILE_VERIFY_URL` n'est jamais prise en compte en production), donc sans accès Internet.
4. **Recette sur le VPS** : sauvegarde/restauration, certificat HTTPS, en-tête HSTS et blocage de `/api/internal/*`
   depuis l'extérieur sont à vérifier une fois sur le serveur réel (non testables en local).
