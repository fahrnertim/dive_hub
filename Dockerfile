# syntax=docker/dockerfile:1
# One image for API + web client + worker (ADR 0004). Multi-arch: docker buildx build --platform linux/amd64,linux/arm64 .

FROM node:24-alpine AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @dive-hub/web build \
 && pnpm --filter @dive-hub/server build \
 && pnpm --filter @dive-hub/server deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production \
    DIVEHUB_HOST=0.0.0.0 \
    DIVEHUB_PORT=3000 \
    DIVEHUB_DATA_DIR=/data \
    DIVEHUB_WEB_DIR=/app/web
WORKDIR /app
# Production dependencies only: Garmin's FIT SDK is a dev dependency and must not ship (ADR 0006).
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist ./web
COPY LICENSE NOTICE ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:3000/api/health/live >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
