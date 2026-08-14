# syntax=docker/dockerfile:1
# Meeting Master (會議大師) — single-container image.
# The Express server (server/index.js) serves the built web bundle from dist/
# AND handles /api/* on ONE port (8899), so no separate web/preview process or
# proxy hop is needed. See vite.config.js (dev proxy) vs server/index.js
# (express.static(DIST) + SPA fallback) — the latter is what runs here.

# ── Build stage: install ALL deps, then vite build → dist/ ──────────────
FROM node:20-alpine AS build
WORKDIR /app
# Deterministic install from the lockfile. NOTE: express (and vite) live in
# devDependencies, so we install the full tree here — needed both to build the
# bundle and (express) to run the server.
COPY package.json package-lock.json ./
RUN npm ci
# Build the SPA bundle into /app/dist.
COPY . .
RUN npm run build

# ── Runtime stage: lean image that just runs the Express server ─────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8899
WORKDIR /app
# Copy the resolved node_modules from the build stage. We do NOT run
# `npm ci --omit=dev` here because express is declared as a devDependency and
# `--omit=dev` would drop it, breaking the server at runtime.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
# Persistent state dirs. These are bind-mounted by docker-compose, but creating
# + chowning them here means the image also runs standalone (`docker run`).
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 8899
# The server has no dedicated /health route; /api/line/status always returns 200
# (reports { connected:false } when no LINE token) — a reliable liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8899/api/line/status >/dev/null 2>&1 || exit 1
CMD ["node", "server/index.js"]
