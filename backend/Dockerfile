# --- Stage 1: Development ---
FROM oven/bun:1 AS dev

WORKDIR /app

# Install deps first (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

EXPOSE 5000

CMD ["bun", "--watch", "src/index.ts"]


# --- Stage 2: Build ---
FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build


# --- Stage 3: Production ---
FROM oven/bun:1 AS prod

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=build /app/dist ./dist

EXPOSE 5000

CMD ["bun", "dist/index.js"]
