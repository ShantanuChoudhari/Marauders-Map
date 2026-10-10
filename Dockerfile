# ══════════════════════════════════════════════════════════════════
# MARAUDER'S MAP — UNIFIED .IO GAME PRODUCTION DOCKERFILE
# Builds shared protocol, React frontend, & Node/Socket.IO backend
# Runs as a single unified service on any cloud platform or VPS
# ══════════════════════════════════════════════════════════════════

FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

# Install clean dependencies
RUN npm ci

# Copy source trees
COPY shared shared
COPY backend backend
COPY frontend frontend

# Build protocol, backend, and static frontend bundle
ENV NODE_ENV=production
RUN npm run build

# ── Production Runtime ──────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy runtime assets and compiled distributions
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/migrations ./backend/migrations
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/frontend/dist ./frontend/dist

EXPOSE 3000

USER node

CMD ["node", "backend/dist/server.js"]
