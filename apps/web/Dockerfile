# syntax=docker/dockerfile:1

FROM node:22-alpine
RUN apk add --no-cache curl
RUN corepack enable pnpm

WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/platform-core/package.json ./packages/platform-core/
COPY packages/ecommerce-common/package.json ./packages/ecommerce-common/
COPY packages/shoptet-client/package.json ./packages/shoptet-client/
COPY packages/upgates-client/package.json ./packages/upgates-client/

ARG PNPM_INSTALL_ARGS=
RUN pnpm install ${PNPM_INSTALL_ARGS}
RUN pnpm rebuild esbuild

COPY packages/db ./packages/db
COPY packages/platform-core ./packages/platform-core
COPY packages/ecommerce-common ./packages/ecommerce-common
COPY packages/shoptet-client ./packages/shoptet-client
COPY packages/upgates-client ./packages/upgates-client
RUN pnpm --filter @puls/db build \
 && pnpm --filter @puls/platform-core build \
 && pnpm --filter @puls/ecommerce-common build \
 && pnpm --filter @puls/shoptet-client build \
 && pnpm --filter @puls/upgates-client build
COPY apps/web ./apps/web

COPY apps/web/docker-entrypoint.sh /usr/local/bin/puls-entrypoint.sh
RUN chmod +x /usr/local/bin/puls-entrypoint.sh

WORKDIR /repo/apps/web

ENV NODE_ENV=development
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/puls-entrypoint.sh"]
CMD ["pnpm", "run", "dev"]
