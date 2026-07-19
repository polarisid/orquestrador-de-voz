# Build deterministico para o Coolify.
# Mais previsivel que deixar o Nixpacks adivinhar.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --omit=optional
COPY --from=build /app/dist ./dist
COPY public ./public

# ./dados so e usado quando SUPABASE_URL esta vazio (store local).
RUN mkdir -p /app/dados
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/index.js"]
