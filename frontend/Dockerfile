# syntax=docker/dockerfile:1
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app

# ---- dependency layer ----
FROM base AS deps
COPY package.json package-lock.json ./
# Cache mount, not a layer - persists npm's package cache across builds
# independent of layer invalidation, so a package-lock.json edit doesn't
# force every package to be re-downloaded from the registry.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ---- dev: next dev (Turbopack), source mounted at runtime ----
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- builder: production build with standalone output ----
FROM deps AS builder
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so this
# must be a build arg, not just a runtime env var on the prod container.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY . .
# Same cache-mount idea for Turbopack's own filesystem cache (see
# next.config.ts's turbopackFileSystemCacheForBuild) - without this mount,
# .next/cache would just be discarded at the end of this stage's layer like
# any other build output, never actually persisting across builds.
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# ---- prod: minimal runtime image, only the standalone server output ----
FROM base AS prod
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
