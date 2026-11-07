#!/bin/sh
# Migrations first (spec, section 12), then the server. A failed migration stops the container.
set -eu
cd /app
pnpm --filter @manga/db migrate:deploy
exec pnpm --filter @manga/web exec next start --hostname 0.0.0.0 --port 3000
