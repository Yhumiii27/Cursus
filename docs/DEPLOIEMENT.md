# Mise en production de Cursus

Guide destiné au service informatique, qui exploite Cursus. Cible retenue par l'entreprise :
une machine Linux louée chez un hébergeur en France ou dans l'Union européenne, joignable
directement depuis Internet (ordinateurs Windows attribués et téléphones fournis par
l'entreprise), Cursus derrière un reverse proxy HTTPS.

```
Navigateur ──HTTPS 443──▶ Caddy (ou nginx) ──HTTP──▶ Cursus 127.0.0.1:3210 ──▶ SQLite /var/lib/cursus
```

Cursus n'écoute que sur la boucle locale : seul le reverse proxy l'atteint. Le proxy porte le
certificat TLS ; Cursus envoie lui-même les en-têtes de sécurité (CSP, HSTS, anti-iframe…).

Sauvegardes et restauration : voir `docs/SAUVEGARDE.md`.

## Avant de commencer

- **Authentification** : hors démonstration, Cursus n'ouvre aucun espace tant que l'authentification
  unique de l'entreprise (OIDC / SAML) n'est pas branchée (chantier distinct, voir
  `docs/RESTE_A_FAIRE.md`). Ce guide prépare l'hébergement ; l'ouverture aux utilisateurs en dépend.
- **Recette** : chaque mise en production, première installation comme mise à jour, est précédée
  d'une recette par le groupe pilote (un RH, un manager, un collaborateur). Voir « Recette ».
- **Données personnelles** : Cursus conserve des données relatives à la santé (visites médicales,
  aptitude, vaccinations) et des documents de voyage. Faire valider le choix de l'hébergeur par le
  DPO : localisation dans l'UE, contrat de sous-traitance (RGPD, article 28) et question d'un
  hébergement certifié HDS.
- **Nom de domaine** : un sous-domaine dédié (dans ce guide `cursus.example.fr`) dont les
  enregistrements DNS A / AAAA pointent vers la machine.

## Machine

- Debian 12 ou Ubuntu 24.04 LTS, 2 vCPU, 2 à 4 Go de mémoire, 20 Go de disque : SQLite n'exige
  aucun serveur de base de données.
- Mises à jour de sécurité automatiques :

  ```bash
  sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
  ```

- Fuseau horaire de Paris : la date du jour de Cursus (échéances, semaines, date de sortie des
  salariés) suit l'heure locale de la machine, souvent laissée en UTC chez l'hébergeur. Le service
  systemd pose aussi `TZ=Europe/Paris`.

  ```bash
  sudo timedatectl set-timezone Europe/Paris
  ```

- Accès SSH par clé uniquement (`PasswordAuthentication no` dans `/etc/ssh/sshd_config`).
- Pare-feu : seuls SSH, HTTP (redirection et certificat) et HTTPS sont ouverts.

  ```bash
  sudo ufw default deny incoming
  sudo ufw allow OpenSSH
  sudo ufw allow 80,443/tcp
  sudo ufw enable
  ```

## Node.js

Node.js 22.18 ou plus récent (TypeScript exécuté nativement, SQLite intégré), par exemple depuis
les paquets NodeSource :

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install nodejs
node --version   # v22.18 ou plus
```

## Utilisateur et dossiers

Un utilisateur système dédié, sans shell ; le code dans `/opt/cursus` (lecture seule pour le
service), la base dans `/var/lib/cursus` (lisible par Cursus seul), la configuration dans `/etc/cursus`.

```bash
sudo useradd --system --home-dir /var/lib/cursus --shell /usr/sbin/nologin cursus
sudo install -d -o cursus -g cursus -m 700 /var/lib/cursus
sudo install -d -o root -g cursus -m 750 /etc/cursus
sudo install -d -o cursus -g cursus -m 755 /opt/cursus
```

Installer le code (dépôt Git ou archive livrée), puis compiler l'interface :

```bash
sudo -u cursus git clone <dépôt> /opt/cursus
cd /opt/cursus
sudo -u cursus npm ci
sudo -u cursus npm run build
```

## Variables d'environnement

Partir du modèle commenté `.env.example` :

```bash
sudo cp /opt/cursus/.env.example /etc/cursus/cursus.env
sudo chown root:cursus /etc/cursus/cursus.env
sudo chmod 640 /etc/cursus/cursus.env
openssl rand -hex 32   # une fois pour CURSUS_SECRET, une autre fois pour KEYSTONE_API_KEY
sudo nano /etc/cursus/cursus.env
```

| Variable | Production |
| --- | --- |
| `NODE_ENV` | `production` |
| `CURSUS_API_PORT` | `3210` (port local, jamais ouvert au pare-feu) |
| `CURSUS_HOST` | à laisser vide : 127.0.0.1 par défaut en production |
| `CURSUS_TRUST_PROXY` | à laisser vide (`loopback`) quand le proxy est sur la même machine ; sinon, son adresse |
| `CURSUS_DB` | `/var/lib/cursus/cursus.db` |
| `CURSUS_SECRET` | 64 caractères aléatoires, propres à cette installation. La changer déconnecte tout le monde |
| `KEYSTONE_API_KEY` | clé aléatoire transmise à Keystone par un canal sûr. Sans elle, les routes Keystone répondent 503 |
| `KEYSTONE_URL`, `KEYSTONE_TOKEN`, `SAGE_URL`, `SAGE_TOKEN`, `SAGE_DOSSIER` | intégrations sortantes, quand elles seront livrées |
| `CURSUS_DEMO`, `CURSUS_TODAY`, `CURSUS_INSECURE_COOKIE` | **jamais** sur ce serveur. La démonstration ouvre l'espace RH sans mot de passe : Cursus refuse de démarrer avec elle, et refuserait de toute façon (403) chaque requête relayée par le proxy |

Au démarrage, Cursus contrôle cette configuration. S'il manque une valeur obligatoire ou si un
réglage est dangereux, il refuse de démarrer, liste chaque problème dans le journal
(`journalctl -u cursus`) et sort avec le code 1.

## Service systemd

`/etc/systemd/system/cursus.service` :

```ini
[Unit]
Description=Cursus — suivi RH
After=network.target

[Service]
Type=simple
User=cursus
Group=cursus
WorkingDirectory=/opt/cursus
EnvironmentFile=/etc/cursus/cursus.env
# Date du jour à l'heure de Paris, quel que soit le fuseau de la machine.
Environment=TZ=Europe/Paris
ExecStart=/usr/bin/node server/src/index.ts
Restart=on-failure
RestartSec=5
UMask=0077
# Durcissement : Cursus n'écrit que dans /var/lib/cursus.
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/cursus
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cursus
sudo systemctl status cursus
journalctl -u cursus -n 50
```

Le journal doit afficher `Cursus — API sur http://127.0.0.1:3210 (application servie)`, sans
« mode démonstration ». Une base vide reste vide : aucune donnée fictive n'est chargée.

## Reverse proxy HTTPS : Caddy (recommandé)

Caddy obtient et renouvelle seul le certificat (Let's Encrypt) et redirige HTTP vers HTTPS.

```bash
sudo apt install caddy
```

`/etc/caddy/Caddyfile` :

```
cursus.example.fr {
	encode zstd gzip
	request_body {
		max_size 3MB
	}
	reverse_proxy 127.0.0.1:3210
}
```

```bash
sudo systemctl reload caddy
```

Caddy transmet `X-Forwarded-Proto` et `X-Forwarded-For` : Cursus, qui fait confiance au proxy
local (`CURSUS_TRUST_PROXY=loopback`), sait que la requête est en HTTPS et ajoute l'en-tête
`Strict-Transport-Security` (HSTS, un an).

## Variante : nginx et certbot

```bash
sudo apt install nginx certbot
sudo install -d /var/www/letsencrypt
```

Le certificat s'obtient d'abord, avec le seul bloc du port 80 : nginx refuse une configuration qui
cite un certificat encore absent. `/etc/nginx/sites-available/cursus` :

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name cursus.example.fr;

    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }   # validation Let's Encrypt
    location / { return 301 https://$host$request_uri; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cursus /etc/nginx/sites-enabled/cursus
sudo nginx -t && sudo systemctl reload nginx
# Renouvellement automatique (minuteur certbot), suivi d'un rechargement de nginx.
sudo certbot certonly --webroot -w /var/www/letsencrypt -d cursus.example.fr --deploy-hook 'systemctl reload nginx'
```

Une fois le certificat présent dans `/etc/letsencrypt/live/cursus.example.fr/`, ajouter le bloc
HTTPS au même fichier :

```nginx
server {
    listen 443 ssl http2;          # Debian 12 (nginx 1.22), Ubuntu 24.04 (nginx 1.24)
    listen [::]:443 ssl http2;     # nginx 1.25.1 et plus : « listen 443 ssl; » puis « http2 on; »
    server_name cursus.example.fr;

    ssl_certificate     /etc/letsencrypt/live/cursus.example.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cursus.example.fr/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 3m;       # imports CSV : 2 Mo côté Cursus

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Vérifications après installation

```bash
curl -sI https://cursus.example.fr/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type'
curl -s https://cursus.example.fr/api/session                   # "demo":false et "user":null
curl -s -o /dev/null -w '%{http_code}\n' http://cursus.example.fr/                       # 301 ou 308 vers HTTPS
curl -s -o /dev/null -w '%{http_code}\n' https://cursus.example.fr/api/integrations/keystone/v1/chantiers/X/go-no-go   # 401 sans clé
```

Depuis un téléphone de l'entreprise, hors du réseau interne : la page de connexion s'affiche en
HTTPS, sans alerte de certificat.

## Postes et téléphones

- Ordinateurs Windows attribués : Edge ou Chrome à jour. Téléphones fournis : Safari ou Chrome à
  jour, verrouillage de l'écran imposé par la gestion de flotte.
- Une session dure 12 heures au plus depuis la connexion, sans prolongation : chacun se reconnecte
  au moins une fois par journée de travail. « Se déconnecter » invalide la session aussitôt.
- Départ d'un salarié : ses sessions sont refusées dès le lendemain de sa date de sortie, à minuit
  heure de Paris (fuseau réglé, voir « Machine »).

## Recette

Décision de l'entreprise : une recette par un groupe pilote (un RH, un manager, un collaborateur)
précède chaque mise en production.

- Instance de recette distincte, installée selon ce guide : autre sous-domaine (par exemple
  `cursus-recette.example.fr`), autre utilisateur ou dossier, autre port local (3211), autre base,
  ses propres `CURSUS_SECRET` et `KEYSTONE_API_KEY`.
- Jamais de mode démonstration sur l'instance de recette : il ouvrirait l'espace RH sans mot de
  passe à tout visiteur d'Internet. Derrière le proxy, Cursus refuse de démarrer avec
  `CURSUS_DEMO=1` et refuserait (403) toute requête relayée. La recette se fait comme en
  production, avec l'authentification unique.
- Données de recette fictives ou anonymisées : jamais de copie de la base de production (données
  de santé). Les données de démonstration peuvent être chargées dans la base de recette, service
  arrêté ; `CURSUS_DEMO=1` ne vaut alors que pour cette commande, jamais pour le service :

  ```bash
  sudo systemctl stop cursus-recette
  cd /opt/cursus-recette
  sudo -u cursus-recette env CURSUS_DEMO=1 CURSUS_DB=/var/lib/cursus-recette/cursus.db node server/src/reset.ts
  sudo systemctl start cursus-recette
  ```

- La nouvelle version y est installée d'abord. Le groupe pilote vérifie, chacun dans son espace :
  connexion et déconnexion, tableau de bord, fiches collaborateurs, temps, absences, formations,
  impression du passeport formation, consultation sur téléphone.
- Le service informatique consigne la version, la date et l'accord des trois pilotes avant de
  passer en production.

## Mise à jour

1. Recette de la nouvelle version (ci-dessus).
2. Sauvegarde de la base juste avant l'opération (`docs/SAUVEGARDE.md`).
3. Installation :

   ```bash
   cd /opt/cursus
   sudo -u cursus git pull          # ou dépôt de la nouvelle archive
   sudo -u cursus npm ci
   sudo -u cursus npm run build
   sudo systemctl restart cursus
   journalctl -u cursus -n 50       # les migrations de données s'exécutent au démarrage
   ```

4. Vérifications après installation (ci-dessus).
5. En cas de problème : revenir à la version précédente (`git checkout <version>`, `npm ci`,
   `npm run build`), restaurer la sauvegarde et redémarrer.

## Exploitation courante

- Surveillance : `https://cursus.example.fr/api/session` doit répondre 200 ; journal du service
  (`journalctl -u cursus`) et du proxy ; espace disque de `/var/lib/cursus`.
- Certificat : renouvelé automatiquement (Caddy ou minuteur certbot) ; vérifier l'échéance une fois
  par trimestre.
- Changer la clé Keystone : nouvelle valeur dans `/etc/cursus/cursus.env`, `systemctl restart
  cursus`, puis transmission à Keystone.
- Keystone alimente les chantiers, projets, affectations et tâches par son API (`docs/API-KEYSTONE.md`) :
  sans elle, une base de production n'a ni chantier ni projet. Ses appels sont tracés dans le journal
  (Paramètres, action `keystone.appel`).
- Changer `CURSUS_SECRET` (fuite supposée) : même procédure ; toutes les sessions sont fermées.
