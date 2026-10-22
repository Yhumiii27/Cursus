# Image de mise en ligne de Cursus (Coolify ou tout hébergeur Docker ; README.md, « Mise en ligne »).
# - Port interne : 3000.
# - Données : /data (base SQLite et sauvegardes) — y monter un volume persistant, sinon elles sont perdues à chaque
#   déploiement. Au démarrage, le conteneur rend ce volume au compte `cursus` de l'image puis abandonne les droits root
#   (server/src/conteneur.ts) : un volume créé par une image antérieure, qui tournait sous root, reste utilisable.
# - Serveur PostgreSQL commun EPC2I : DATABASE_URL (rôle cursus_app, base epc2i), variable d'exécution de l'hébergeur
#   seulement, jamais dans l'image ni au build (la construction ne touche pas à la base). Avec elle, /data ne sert plus
#   qu'au fichier SQLite de repli et à ses sauvegardes (retour arrière, reprise des données) : garder le volume.
# - Variables obligatoires : CURSUS_SECRET et KEYSTONE_API_KEY.
# - Écoute sur toutes les interfaces du conteneur (le proxy de l'hébergeur est dans un autre conteneur) ; en-têtes
#   X-Forwarded-* crus des seules adresses privées du réseau Docker.
# Hors conteneur, l'installation se fait par le service systemd (deploy/cursus.service, docs/DEPLOIEMENT.md).

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
    CURSUS_TRUST_PROXY=loopback,uniquelocal \
    CURSUS_API_PORT=3000 \
    CURSUS_DB=/data/cursus.db \
    CURSUS_CONTENEUR=1
WORKDIR /opt/cursus
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY docs/keystone-openapi.json ./docs/keystone-openapi.json
COPY --from=construction /app/dist ./dist
# Compte système dédié, sans shell ; la base et ses sauvegardes dans le volume, fermé aux autres comptes (700). Pas de
# USER : le processus démarre sous root, rend /data à `cursus` et prend son identité avant d'ouvrir la base
# (server/src/conteneur.ts) ; npm run comptes, backup et restore lancés par `docker exec` font de même.
RUN useradd --system --home-dir /data --shell /usr/sbin/nologin cursus \
 && install -d -o cursus -g cursus -m 700 /data
VOLUME /data
EXPOSE 3000
# Point de santé : appel local, d'où l'état de la base, la version et les envois en échec (server/src/supervision.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.CURSUS_API_PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# SIGTERM (docker stop) : Cursus finit les requêtes en cours (10 s au plus), ferme la base et retire son verrou.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
