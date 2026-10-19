# Image du panel Motflix : serveur Fastify + interface React compilée.
# Construite par scripts/install.sh et scripts/update.sh (docker compose build motflix).

# ─── Dépendances et compilation de l'interface ──────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @motflix/web

# ─── Dépendances de production du serveur ───────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace @motflix/server --include-workspace-root=false --no-audit --no-fund

# ─── Image finale ───────────────────────────────────────────────────────
FROM node:24-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    MOTFLIX_DATA_DIR=/config \
    MOTFLIX_WEB_DIR=/app/web \
    NODE_NO_WARNINGS=1
WORKDIR /app/server
COPY --from=deps /app/node_modules /app/node_modules
COPY apps/server/package.json ./
COPY apps/server/src ./src
COPY --from=build /app/apps/web/dist /app/web
RUN mkdir -p /config && chown node:node /config
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "src/index.ts"]
