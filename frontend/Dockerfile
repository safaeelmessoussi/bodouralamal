# The frontend is one environment-independent static artifact: runtime origins
# are same-origin paths, so no deployment URL is baked into this build.
FROM node:24.11.0-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:stable-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
