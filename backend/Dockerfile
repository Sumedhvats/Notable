# --- Stage 1: Development ---
FROM node:22-alpine AS dev

WORKDIR /app

# Install deps first (cached layer)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

EXPOSE 5000

CMD ["npm", "run", "dev"]


# --- Stage 2: Build ---
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


# --- Stage 3: Production ---
FROM node:22-alpine AS prod

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 5000

CMD ["npm", "start"]
