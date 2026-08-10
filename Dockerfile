# Grisomaq — imagem para deploy no Easypanel (ou qualquer Docker host).
FROM node:22-slim

# python3/make/g++ para compilar o better-sqlite3 (módulo nativo).
# curl é necessário para o health check do Easypanel/Swarm (senão o container
# é marcado como não-saudável e reiniciado em loop).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala as dependências (usa o package-lock para builds reprodutíveis).
COPY package.json package-lock.json ./
RUN npm ci

# Copia o restante do código e faz o build de produção.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Banco SQLite persistente — MONTAR um volume em /app/data no Easypanel.
ENV GRISOMAQ_DB_PATH=/app/data/grisomaq.db

EXPOSE 3000

# Health check próprio (bate em /login, que responde 200) — evita o loop de reinício.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=5 \
  CMD curl -fsS http://localhost:3000/login || exit 1

# Roda o Next diretamente (sinais tratados melhor que via npm).
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
