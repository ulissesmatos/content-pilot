# syntax=docker/dockerfile:1
# Multi-stage único para os 3 serviços: targets `web`, `worker` e `migrate`.

FROM node:22-alpine AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ---- dependências (cache de camada por lockfile) ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

# ---- build do painel (Next standalone) ----
FROM deps AS build
COPY . .
RUN pnpm --filter web build

# ---- runtime: web ----
FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
# Embutido na imagem (além do healthcheck do compose): o Coolify recria o
# container a partir dela, e sem isto o Docker não tem State.Health nenhum
# pra reportar — é o que aparece como "unknown" no painel em vez de healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]

# ---- runtime: worker (tsx executa o TS direto — core/db são fonte) ----
FROM deps AS worker
COPY . .
ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["pnpm", "exec", "tsx", "src/index.ts"]

# ---- migrate + seed (roda uma vez por deploy) ----
FROM deps AS migrate
COPY . .
WORKDIR /app/packages/db
CMD ["sh", "-c", "pnpm exec drizzle-kit migrate && pnpm exec tsx src/seed.ts"]
