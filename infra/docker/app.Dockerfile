# syntax=docker/dockerfile:1
# One image for the web app and the worker (same workspace, different command).
# Build from the repository root:  docker build -f infra/docker/app.Dockerfile -t manga-app .

# ---- build: full install, Prisma client, Next.js build, then production dependencies only -------
FROM node:24-bookworm-slim AS build

ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    npm_config_store_dir=/home/node/.pnpm-store
RUN npm install -g pnpm@12.18.0 && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /app && chown node:node /app

USER node
WORKDIR /app
COPY --chown=node:node . .
# The package store lives in a build cache, not in the image.
RUN --mount=type=cache,target=/home/node/.pnpm-store,uid=1000,gid=1000 pnpm install --frozen-lockfile

# Build-time only: the data source and the public Turnstile key are inlined into the client
# bundle. The database URL is a placeholder that never reaches the runtime environment.
ARG DATA_SOURCE=db
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm db:generate \
    && DATA_SOURCE=${DATA_SOURCE} \
       NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} \
       DATABASE_URL=postgresql://build:build@localhost:5432/build \
       pnpm build

# Production dependencies only. prisma (migrations) and tsx (worker) are regular dependencies for that reason.
RUN pnpm prune --prod && rm -rf apps/web/.next/cache apps/web/e2e apps/web/test apps/scraper docs infra

# ---- runtime: only what is needed to run (a prune in the same stage would not shrink the image) ----
FROM node:24-bookworm-slim

ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN npm install -g pnpm@12.18.0 && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node --chmod=755 infra/docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh

EXPOSE 3000
# Default command is the web server; compose overrides it for the worker.
CMD ["web-entrypoint.sh"]
