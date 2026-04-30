FROM node:22-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN apk add --no-cache python3 make g++ linux-headers
RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ai-services/package.json ./packages/ai-services/package.json
COPY apps/hammurabi/package.json ./apps/hammurabi/package.json
COPY packages/auth-providers/package.json ./packages/auth-providers/package.json
COPY packages/hammurabi-cli/package.json ./packages/hammurabi-cli/package.json
COPY packages/sse-streaming/package.json ./packages/sse-streaming/package.json
COPY packages/telemetry/package.json ./packages/telemetry/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json

RUN pnpm install --filter hammurabi... --frozen-lockfile

COPY apps/hammurabi ./apps/hammurabi
COPY packages/ai-services ./packages/ai-services
COPY packages/auth-providers ./packages/auth-providers
COPY packages/hammurabi-cli ./packages/hammurabi-cli
COPY packages/sse-streaming ./packages/sse-streaming
COPY packages/telemetry ./packages/telemetry
COPY packages/tsconfig ./packages/tsconfig

RUN pnpm --filter hammurabi run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=20001
ENV HAMMURABI_DATA_DIR=/data/.hammurabi

RUN mkdir -p /data/.hammurabi

COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/hammurabi ./apps/hammurabi
COPY --from=build /workspace/packages/ai-services ./packages/ai-services
COPY --from=build /workspace/packages/auth-providers ./packages/auth-providers
COPY --from=build /workspace/packages/hammurabi-cli ./packages/hammurabi-cli
COPY --from=build /workspace/packages/sse-streaming ./packages/sse-streaming
COPY --from=build /workspace/packages/telemetry ./packages/telemetry
COPY --from=build /workspace/packages/tsconfig ./packages/tsconfig

WORKDIR /app/apps/hammurabi

EXPOSE 20001

CMD ["node", "dist-server/server/index.js"]
