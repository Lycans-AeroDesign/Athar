# syntax=docker/dockerfile:1
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app

# ---- dependency layer ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

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
RUN npm run build

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
