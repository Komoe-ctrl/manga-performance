# MANGA PERFORMANCE — maquette front

Maquette fonctionnelle cliquable (données fictives, aucun backend) de la plateforme du cabinet : site public, back-office (`/admin`) et espace client (`/espace-client`).

Spécification : [SPEC_FRONT_MANGA_PERFORMANCE.md](SPEC_FRONT_MANGA_PERFORMANCE.md).

## Démarrer

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm lint
pnpm typecheck
pnpm build
```

## Architecture

- `src/lib/types` : modèle métier
- `src/lib/mock` : fixtures déterministes (jamais importées par les composants)
- `src/lib/services` : API asynchrone avec latence simulée, store en mémoire (non persisté au rechargement)
- `src/components` : composants par domaine (`crm`, `billing`, `marketing`, `scraper`, `client`, `demo`, `public`) et partagés (`shared`, `ui`)

## Authentification simulée

- Back-office : `/admin/connexion`, bouton « Se connecter en tant que consultant »
- Espace client : `/espace-client/connexion`, sélecteur de profil ou email d'un client avec accès actif et mot de passe de 4 caractères minimum

## Points en attente du client

Recherchez `TODO` dans `src/` : formules des KPI du dashboard, relances (interne ou email), envoi de la newsletter, langue, contenus définitifs.
