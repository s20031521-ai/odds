# syntax=docker/dockerfile:1
# odds-tool web image (Phase 2 Task 2): builds the PWA, serves it with caddy.
# Build from the REPO ROOT:  docker build -f deploy/web.Dockerfile .
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src/ src/
COPY public/ public/
COPY shared/ shared/
RUN npm run build

FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
