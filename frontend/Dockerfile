# Reference frontend Dockerfile. Lives at the root of every frontend repo.

FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./


FROM base AS dev

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5173"]


FROM base AS build

RUN npm ci
COPY . .
RUN npm run build


FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
