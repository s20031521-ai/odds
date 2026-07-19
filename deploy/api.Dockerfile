# syntax=docker/dockerfile:1
# odds-tool api image (Phase 2 Task 2).
# Build from the REPO ROOT:  docker build -f deploy/api.Dockerfile .
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only; lockfile-pinned.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server runtime: entry + http/auth/domain, db migrations, shared model code,
# and scripts (collector/import entry points reused by later Phase 2 tasks).
# NOTE: hdc-collector loads the parsing modules at runtime through Vite's SSR
# loader (ssrLoadModule("/src/oddsApi.ts")), so src/ must ship in the image.
COPY server/ server/
COPY shared/ shared/
COPY db/ db/
COPY scripts/ scripts/
COPY src/ src/

# Entrypoint composes DATABASE_URL / SESSION_SECRET from /run/secrets at
# container start so no secret is ever baked into an image layer.
# NOTE: this Docker ignores secret uid/gid/mode (mounts root-only), so the
# entrypoint starts as root, reads secrets, then drops to uid/gid 1000 (node)
# via setpriv before exec'ing the server.
COPY deploy/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
COPY deploy/collector-entrypoint.sh /usr/local/bin/collector-entrypoint.sh
RUN chmod 0555 /usr/local/bin/api-entrypoint.sh /usr/local/bin/collector-entrypoint.sh && command -v setpriv \
  && mkdir -p /app/data /app/public && chown 1000:1000 /app/data /app/public

EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/api-entrypoint.sh"]
