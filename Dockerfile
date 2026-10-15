# Image de Cursus, facultative : seulement si l'hébergeur impose des conteneurs. L'installation de référence est le
# service systemd (deploy/cursus.service, docs/DEPLOIEMENT.md) ; ce conteneur se place derrière le même reverse proxy
# HTTPS (Caddy ou nginx), sur la machine elle-même.
#
#   docker build -t cursus:$(node -p "require('./package.json').version") .
#   docker run -d --name cursus --restart on-failure --stop-timeout 20 \
#     --env-file /etc/cursus/cursus.env -e CURSUS_DB=/var/lib/cursus/cursus.db -e CURSUS_HOST=0.0.0.0 \
#     -e CURSUS_TRUST_PROXY=172.16.0.0/12 \
#     -v cursus-donnees:/var/lib/cursus -p 127.0.0.1:3210:3210 cursus:<version>
#
# Voir docs/DEPLOIEMENT.md, « Variante : conteneur Docker ».

# — Construction de l'interface (dépendances de développement : Vite, TypeScript) —
FROM node:22-slim AS construction
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# — Exécution : dépendances de production seulement, compte sans droits —
FROM node:22-slim
ENV NODE_ENV=production \
    TZ=Europe/Paris \
    CURSUS_HOST=0.0.0.0 \
    CURSUS_API_PORT=3210 \
    CURSUS_DB=/var/lib/cursus/cursus.db
WORKDIR /opt/cursus
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY docs/keystone-openapi.json ./docs/keystone-openapi.json
COPY --from=construction /app/dist ./dist
# Compte système dédié, sans shell ; la base et ses sauvegardes dans le volume, fermé aux autres comptes (700).
RUN useradd --system --home-dir /var/lib/cursus --shell /usr/sbin/nologin cursus \
 && install -d -o cursus -g cursus -m 700 /var/lib/cursus
USER cursus
VOLUME /var/lib/cursus
EXPOSE 3210
# Point de santé : appel local, d'où l'état de la base, la version et les envois en échec (server/src/supervision.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.CURSUS_API_PORT || 3210) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# SIGTERM (docker stop) : Cursus finit les requêtes en cours (10 s au plus), ferme la base et retire son verrou.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
