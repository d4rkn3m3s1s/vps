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
RUN npm run build --workspace @vps/web

FROM cgr.dev/chainguard/node:latest AS runtime
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/dashboard/package.json ./apps/dashboard/package.json
COPY --from=build /repo/apps/dashboard/.next ./apps/dashboard/.next
COPY --from=build /repo/apps/dashboard/public ./apps/dashboard/public
COPY --from=build /repo/apps/dashboard/next.config.mjs ./apps/dashboard/next.config.mjs
WORKDIR /repo/apps/dashboard
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
