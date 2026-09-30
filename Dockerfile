FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS base
WORKDIR /app

FROM base AS test
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vitest.config.ts ./
COPY src ./src
COPY test ./test
RUN npm run typecheck && npm test

FROM test AS dependencies
RUN npm prune --omit=dev && npm cache clean --force

FROM base AS production
ARG REVISION=development
LABEL org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production TZ=Europe/Belgrade DATABASE_PATH=/app/data/office.db HEARTBEAT_PATH=/app/data/heartbeat.json
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=test /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 CMD ["node", "dist/cli.js", "health"]
CMD ["node", "dist/main.js"]
