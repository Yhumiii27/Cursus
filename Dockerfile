# Image de mise en ligne de Cursus (Coolify ou tout hébergeur Docker).
# - Port interne : 3000.
# - Données : /data (base SQLite et sauvegardes) — y monter un volume persistant, sinon elles sont perdues à chaque déploiement.
# - Variables obligatoires : CURSUS_SECRET et KEYSTONE_API_KEY (README.md, « Configuration »).
# Node 22.18 ou plus récent est requis : le serveur exécute directement ses fichiers TypeScript.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Écoute sur toutes les interfaces du conteneur (le proxy de l'hébergeur est dans un autre conteneur) ;
# en-têtes X-Forwarded-* crus des seules adresses privées du réseau Docker.
ENV NODE_ENV=production \
    PORT=3000 \
    CURSUS_HOST=0.0.0.0 \
    CURSUS_TRUST_PROXY=loopback,uniquelocal \
    CURSUS_DB=/data/cursus.db \
    TZ=Europe/Paris

EXPOSE 3000
CMD ["node", "server/src/index.ts"]
