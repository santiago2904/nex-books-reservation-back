# syntax=docker/dockerfile:1.7
# Target platform: linux/amd64 (ECS Fargate x86_64)

# ----- deps -----
FROM --platform=linux/amd64 node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm prisma generate

# ----- build -----
FROM --platform=linux/amd64 node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
RUN pnpm build

# ----- runtime -----
FROM --platform=linux/amd64 node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable && apk add --no-cache dumb-init wget openssl openssl-dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json .
RUN chown -R node:node /app
ENV NODE_ENV=production
EXPOSE 4000
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
