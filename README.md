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
