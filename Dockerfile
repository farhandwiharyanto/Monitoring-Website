# ---- build frontend ----
FROM node:20-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- server ----
FROM node:20-bookworm-slim
# openssl: dibutuhkan Prisma engine; iputils-ping: monitor tipe Ping
RUN apt-get update && apt-get install -y --no-install-recommends openssl iputils-ping ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
COPY server/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist

ENV NODE_ENV=production \
    PORT=3001 \
    CLIENT_DIST=/app/client/dist
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:3001/api/health || exit 1
# Terapkan migration Prisma lalu jalankan server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
