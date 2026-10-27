FROM node:22-bookworm-slim
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY patches patches
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/logging packages/logging
COPY apps/phone-agent apps/phone-agent
RUN corepack enable && pnpm install --frozen-lockfile --prod --filter "@savingroup/phone-agent..."
WORKDIR /app/apps/phone-agent
# The voice activity model is fetched once at build time so a call never waits on a download.
RUN pnpm exec tsx src/index.ts download-files
CMD ["pnpm", "exec", "tsx", "src/index.ts", "start"]
