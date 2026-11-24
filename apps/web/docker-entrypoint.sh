#!/bin/sh
set -e
cd /repo
echo "puls web: workspace sync for bind mounts..."
pnpm install --frozen-lockfile
pnpm --filter @puls/db build
pnpm --filter @puls/platform-core build
pnpm --filter @puls/ecommerce-common build
pnpm --filter @puls/shoptet-client build
pnpm --filter @puls/upgates-client build
cd /repo/apps/web
echo "puls: applying Drizzle migrations..."
pnpm exec drizzle-kit migrate
if [ "${PULS_DEV_SEED:-1}" = "1" ]; then
  echo "puls: seeding dev fixtures..."
  pnpm exec tsx scripts/seed.ts || echo "puls: seed failed (continuing)"
fi
echo "puls: starting app..."
exec "$@"
