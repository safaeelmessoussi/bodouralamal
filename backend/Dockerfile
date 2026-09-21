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

# **One static `ffmpeg` binary, pinned by digest** (SRS Revision 168 §2). It
# exists for exactly one job: REMUXING (`-c copy`, nothing is re-encoded) the
# ten-second safety segments of a recording whose recorder died mid-class into
# the MP4 the library keeps. Debian's own package would add 481 MB and two
# hundred packages to this image; this is one 135 MB file in a layer every
# release shares, so it is stored and pulled once, not per deployment.
FROM mwader/static-ffmpeg:7.1@sha256:a8090df5f5608daef387e1b2e93b98aaacb4d92153ad904e7d715c725724fca4 AS ffmpeg

FROM node:24.11.0-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      tzdata ca-certificates openssl curl \
  && rm -rf /var/lib/apt/lists/*
# Before anything that changes per release, so the layer is shared.
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
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
