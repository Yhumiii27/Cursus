# Image de mise en ligne de Cursus (Coolify ou tout hébergeur Docker).
# - Port interne : 3000.
# - Données : /data (base SQLite) — y monter un volume persistant, sinon elles sont perdues à chaque déploiement.
# Node 22.18 ou plus récent est requis : le serveur exécute directement ses fichiers TypeScript.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    CURSUS_DB=/data/cursus.db \
    TZ=Europe/Paris

EXPOSE 3000
CMD ["node", "server/src/index.ts"]
