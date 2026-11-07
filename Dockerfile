# ============================================================================
# AAROHAN MOBILITY PLATFORM • PRODUCTION MULTI-STAGE DOCKERFILE
# Lilongwe, Malawi • Optimized for Render, Railway, or Fly.io
# ============================================================================

# Stage 1: Dependencies & Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache libc6-compat python3 make g++

COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for prisma and tailwind)
RUN npm ci

COPY . .

# Generate Prisma Client & compile production CSS
RUN npx prisma generate
RUN npx tailwindcss -i shared/input.css -o shared/tailwind.built.css --minify || true

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install runtime dependencies for Prisma engine
RUN apk add --no-cache openssl libc6-compat

# Create non-root user for container security
RUN addgroup -S -g 1001 aarohan && adduser -S -u 1001 aarohan -G aarohan

# Copy package manifests and install production-only dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy Prisma schema and generated engines from builder
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy application source code and built CSS
COPY --from=builder /app/services ./services
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/sockets ./sockets
COPY --from=builder /app/middleware ./middleware
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/rider ./rider
COPY --from=builder /app/driver ./driver
COPY --from=builder /app/admin ./admin
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/landing.html ./landing.html
# Needed at runtime: location data, legal pages, admin script, and the Prisma CLI for `migrate deploy`
COPY --from=builder /app/data ./data
COPY --from=builder /app/legal ./legal
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Set proper ownership
RUN chown -R aarohan:aarohan /app

USER aarohan

EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
