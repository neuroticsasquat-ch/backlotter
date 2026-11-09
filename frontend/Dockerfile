# Reference frontend Dockerfile. Lives at the root of every frontend repo.

FROM node:22-slim AS base
WORKDIR /app
# workerd (the dev server's SSR runtime, via @cloudflare/vite-plugin) loads the system CA
# store at startup and refuses to start without one, which -slim doesn't ship (miniflare
# 5.20261101, NEU-2236).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./


FROM base AS dev

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5173"]


FROM base AS build

RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build


FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
