# SRS §3.1a: exact Node version pinned (even-numbered LTS line, floor 22).
# TD-11: tzdata present and pinned in the image so Africa/Casablanca (incl.
# Morocco's Ramadan DST suspensions) stays current with IANA updates.
# Production images are BUILT IN CI and pulled — never built on the VPS (§19.1).

FROM node:24.11.0-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
# `npx prisma generate` joins this stage when schema.prisma lands (M1 schema task).
RUN npm run build && npm prune --omit=dev

FROM node:24.11.0-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tzdata curl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Africa/Casablanca
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
