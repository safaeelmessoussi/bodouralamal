# SRS §3.1a: exact Node version pinned (even-numbered LTS line, floor 22).
# TD-11: tzdata present and pinned in the image so Africa/Casablanca — including
# Morocco's Ramadan DST suspensions — stays current with IANA updates.
# Production images are BUILT IN CI and pulled, never built on the 4 GB VPS
# (§19.1 B4); the emergency-only fallback is a full stack-down + compose build.
#
# openssl is required by Prisma's query engine; without it the CLI warns and
# engine resolution can fail (§19.1 step 5 runs migrations inside this image).

FROM node:24.11.0-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      tzdata ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# **`--ignore-scripts`, because this stage has no schema yet.** `postinstall`
# runs `prisma generate` — which is exactly what a developer's `npm install`
# should do, and exactly what cannot work here: only the two manifests are
# copied at this point, deliberately, so that a source change does not
# invalidate the dependency layer. The build stage below copies `prisma/` and
# runs the generate explicitly, which is the same command at the point where it
# has something to read.
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:24.11.0-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      tzdata ca-certificates openssl curl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Africa/Casablanca
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
# The schema and the FULL migration history — including the hand-written SQL of
# TD-6a — must ship in the image: §19.1 step 5 applies them with
# `docker compose run --rm api npx prisma migrate deploy`. The prisma CLI and
# dotenv are runtime dependencies for exactly this reason, so they survive
# `npm prune --omit=dev`.
COPY prisma ./prisma

USER node
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
