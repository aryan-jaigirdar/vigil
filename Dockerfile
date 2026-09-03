# Multi-stage build for vigil.
# Stage 1 installs every dependency and compiles the TypeScript to dist/.
# The final stage carries only the compiled output and production dependencies.

FROM node:20-slim AS build
WORKDIR /app

# better-sqlite3 is a native module, so the builder needs a toolchain in case
# a prebuilt binary is unavailable for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first so the layer is cached until the manifests change.
COPY package.json package-lock.json ./
RUN npm ci

# Compile, then drop devDependencies so node_modules holds only what runtime
# needs, including the already-built better-sqlite3 binary.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node vigil.yaml ./

# Let the unprivileged node user write the SQLite database into the workdir.
RUN chown node:node /app
USER node

EXPOSE 3080
CMD ["node", "dist/cli.js", "run", "--config", "vigil.yaml"]
