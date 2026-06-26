FROM cgr.dev/chainguard/node:latest-dev AS base
WORKDIR /repo
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN npm install

FROM deps AS build
COPY . .
RUN npm run db:generate --workspace @vps/api
RUN npm run build --workspace @vps/api

FROM cgr.dev/chainguard/node:latest AS runtime
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/docs ./docs
COPY --from=build /repo/.env.example ./.env.example
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]
