#!/bin/sh
set -e
cd /repo
echo "puls mcp: workspace sync for bind mounts..."
pnpm install --frozen-lockfile
pnpm --filter @puls/db build
pnpm --filter @puls/platform-core build
pnpm --filter @puls/ecommerce-common build
pnpm --filter @puls/shoptet-client build
pnpm --filter @puls/upgates-client build
cd /repo/apps/mcp-server
pnpm run build
exec node dist/index.js
