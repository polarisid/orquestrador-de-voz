# Build em estagio unico.
#
# A versao anterior tinha dois estagios, e o BuildKit rodava os dois "npm
# install" em paralelo — pico de memoria dobrado. Numa VPS que ja roda n8n,
# Chatwoot, Evolution API e varios Postgres, isso derruba o build sem deixar
# mensagem de erro: o processo e morto, nao falha.
#
# Estagio unico instala uma vez, compila, e depois remove as dependencias de
# desenvolvimento. Imagem final fica praticamente do mesmo tamanho.

FROM node:22-alpine
WORKDIR /app

COPY package.json tsconfig.json ./

# NODE_ENV so entra depois: com production, o npm pula as devDependencies
# e o tsc nao existiria para compilar.
RUN npm install

COPY src ./src

# Teto de memoria explicito. Sem isto o tsc pode pedir mais do que a VPS tem
# no momento e ser morto pelo OOM killer, de novo sem mensagem.
RUN NODE_OPTIONS=--max-old-space-size=640 npx tsc

# Fora as ferramentas de build; o @supabase/supabase-js FICA — ele e carregado
# dinamicamente quando o Supabase esta configurado, e sem ele o boot quebra.
RUN npm prune --omit=dev

COPY public ./public

ENV NODE_ENV=production
# So usado quando o Supabase nao esta configurado.
RUN mkdir -p /app/dados

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/index.js"]
