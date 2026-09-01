# Reference frontend Dockerfile. Lives at the root of every frontend repo.

FROM node:22-slim AS base
WORKDIR /app
COPY package.json package-lock.json* ./


FROM base AS dev

RUN npm ci

COPY . .

EXPOSE 5173

# --host is required: without it Vite binds 127.0.0.1 inside the container and
# the published port answers nothing.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]


FROM base AS build

RUN npm ci
COPY . .
RUN npm run build


FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
