# Grisomaq — imagem para deploy no Easypanel (ou qualquer Docker host).
FROM node:22-slim

# Dependências para compilar o better-sqlite3 (módulo nativo).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala as dependências (usa o package-lock para builds reprodutíveis).
COPY package.json package-lock.json ./
RUN npm ci

# Copia o restante do código e faz o build de produção.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Banco SQLite persistente — MONTAR um volume em /app/data no Easypanel,
# senão o banco (usuários + histórico) se perde a cada redeploy.
ENV GRISOMAQ_DB_PATH=/app/data/grisomaq.db

EXPOSE 3000
CMD ["npm", "start"]
